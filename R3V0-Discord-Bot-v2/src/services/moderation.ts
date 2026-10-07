import { PermissionFlagsBits, type GuildMember, type User } from 'discord.js';
import type { Context } from '../core/types.js';
import { protectedTarget } from '../core/access.js';
import { colors, goatEmbed, noMentions } from '../core/embeds.js';
import { clip, errorCode, errorText, humanDuration, Mutex, parseDuration, stamp, UserError } from '../core/util.js';

export interface CaseRow {
  id: number; guild_id: string; user_id: string; moderator_id: string; action: string;
  reason: string; created_at: number; expires_at: number | null; status: string;
  dm_status: string; audit_reason: string | null; retry_at: number; error: string | null;
}
export class ModerationService {
  private readonly mutex = new Mutex();
  private busy = false;
  private timer?: NodeJS.Timeout;
  constructor(private readonly ctx: Context) {}
  start(): void { this.timer = setInterval(() => { void this.tick(); }, 1000); }
  stop(): void { if (this.timer) clearInterval(this.timer); }
  private createCase(userId: string, moderatorId: string, action: string, reason: string, expires: number | null): CaseRow {
    const r = this.ctx.db.run('INSERT INTO moderation_cases(guild_id,user_id,moderator_id,action,reason,created_at,expires_at) VALUES(?,?,?,?,?,?,?)',
      this.ctx.guild.id, userId, moderatorId, action, reason, Date.now(), expires);
    const id = Number(r.lastInsertRowid);
    const auditReason = clip(`[GOAT#${id}] ${moderatorId}: ${reason}`, 512);
    this.ctx.db.run('UPDATE moderation_cases SET audit_reason=? WHERE id=?', auditReason, id);
    return this.ctx.db.get<CaseRow>('SELECT * FROM moderation_cases WHERE id=?', id)!;
  }
  private async target(user: User, moderatorId: string, permission: bigint, requireMember: boolean): Promise<GuildMember | undefined> {
    if (user.id === moderatorId || user.id === this.ctx.client.user?.id || this.ctx.config.access.ownerUserIds.includes(user.id) || user.id === this.ctx.guild.ownerId) {
      throw new UserError('This member is protected from this action.');
    }
    const me = await this.ctx.guild.members.fetchMe();
    if (!me.permissions.has(permission)) throw new UserError('GOAT is missing the permission required for this moderation action.');
    let member: GuildMember | undefined;
    try { member = await this.ctx.guild.members.fetch({ user: user.id, force: true }); }
    catch (err) { if (errorCode(err) !== 10007) throw err; }
    if (!member) { if (requireMember) throw new UserError('That user is not a member of this server.'); return undefined; }
    if (protectedTarget(member, this.ctx.config)) throw new UserError('This member is protected from this action.');
    if (me.roles.highest.comparePositionTo(member.roles.highest) <= 0) throw new UserError('Move the GOAT bot role above this member’s highest role.');
    if (!this.ctx.config.access.ownerUserIds.includes(moderatorId)) {
      const actor = await this.ctx.guild.members.fetch({ user: moderatorId, force: true });
      if (actor.roles.highest.comparePositionTo(member.roles.highest) <= 0) throw new UserError('You cannot moderate a member with an equal or higher role.');
    }
    return member;
  }
  private async dm(user: User, row: CaseRow, title: string, duration: string): Promise<string> {
    try {
      const actor = await this.ctx.guild.members.fetch(row.moderator_id).catch(() => undefined);
      await user.send({ embeds: [goatEmbed(title, ['ban', 'mute', 'warn'].includes(row.action) ? colors.orange : colors.green)
        .setDescription(`Server: **${this.ctx.guild.name}**`).addFields({ name: 'Reason', value: clip(row.reason, 1000) },
          { name: 'Moderator', value: `${actor?.displayName ?? 'Moderator'}\n<@${row.moderator_id}> • \`${row.moderator_id}\`` },
          { name: 'Duration', value: duration }, { name: 'Case ID', value: `#${row.id}` })], allowedMentions: noMentions,
        nonce: `goat-case-${row.id}`, enforceNonce: true });
      this.ctx.db.run("UPDATE moderation_cases SET dm_status='sent' WHERE id=?", row.id);
      return 'Sent';
    } catch (err) {
      const state = errorCode(err) === 50007 ? 'blocked' : 'failed';
      this.ctx.db.run('UPDATE moderation_cases SET dm_status=? WHERE id=?', state, row.id);
      this.ctx.logger.debug({ caseId: row.id, error: errorText(err) }, 'GOAT moderation DM unavailable');
      return 'Unavailable — DMs are disabled or the user could not be reached';
    }
  }
  private log(row: CaseRow): void {
    const fresh = this.ctx.db.get<CaseRow>('SELECT * FROM moderation_cases WHERE id=?', row.id)!;
    this.ctx.logs.enqueue({ embeds: [goatEmbed(`Moderation • ${row.action.toUpperCase()}`, row.action === 'ban' ? colors.red : colors.orange)
      .addFields({ name: 'User', value: `<@${row.user_id}>\nID: \`${row.user_id}\``, inline: true },
        { name: 'Moderator', value: `<@${row.moderator_id}>\nID: \`${row.moderator_id}\``, inline: true },
        { name: 'Case', value: `#${row.id}`, inline: true }, { name: 'Reason', value: clip(row.reason, 1000) },
        { name: 'Expires', value: row.expires_at ? `${stamp(row.expires_at)}\n${stamp(row.expires_at, 'R')}` : row.action === 'ban' ? 'Permanent' : 'Not applicable' },
        { name: 'DM', value: fresh.dm_status }).toJSON()] }, `case:${row.id}`);
  }
  async ban(user: User, moderatorId: string, reason: string, duration?: string): Promise<{ caseId: number; dm: string }> {
    return this.mutex.run(user.id, async () => {
      const ms = duration ? parseDuration(duration, 365 * 86_400_000) : null;
      await this.target(user, moderatorId, PermissionFlagsBits.BanMembers, false);
      const row = this.createCase(user.id, moderatorId, 'ban', reason, ms ? Date.now() + ms : null);
      // Deliver before removal; Discord often blocks server-based DMs after a ban.
      const dm = await this.dm(user, row, 'Ban Notice', ms ? `${humanDuration(ms)} • ends ${stamp(row.expires_at!)}` : 'Permanent');
      try {
        await this.ctx.guild.members.ban(user.id, { reason: row.audit_reason! });
        this.ctx.db.run("UPDATE moderation_cases SET status='active' WHERE id=?", row.id);
      } catch (err) {
        this.ctx.db.run("UPDATE moderation_cases SET status='failed',error=? WHERE id=?", errorText(err), row.id);
        if (dm === 'Sent') await user.send({ embeds: [goatEmbed('Ban Not Applied', colors.green).setDescription(`The ban in case #${row.id} could not be applied. That notice did not result in a ban.`)], allowedMentions: noMentions }).catch(() => undefined);
        throw err;
      }
      this.log(row);
      return { caseId: row.id, dm };
    });
  }
  async mute(user: User, moderatorId: string, reason: string, duration: string): Promise<{ caseId: number; dm: string }> {
    return this.mutex.run(user.id, async () => {
      const ms = parseDuration(duration, 28 * 86_400_000);
      const member = await this.target(user, moderatorId, PermissionFlagsBits.ModerateMembers, true);
      if (!member?.moderatable) throw new UserError('Discord does not allow GOAT to timeout this member. Check role order and administrator permissions.');
      const row = this.createCase(user.id, moderatorId, 'mute', reason, Date.now() + ms);
      try { await member.disableCommunicationUntil(row.expires_at!, row.audit_reason!); }
      catch (err) { this.ctx.db.run("UPDATE moderation_cases SET status='failed',error=? WHERE id=?", errorText(err), row.id); throw err; }
      this.ctx.db.run("UPDATE moderation_cases SET status='active' WHERE id=?", row.id);
      const dm = await this.dm(user, row, 'Timeout Notice', `${humanDuration(ms)} • ends ${stamp(row.expires_at!)}`);
      this.log(row);
      return { caseId: row.id, dm };
    });
  }
  async unmute(user: User, moderatorId: string, reason: string): Promise<{ caseId: number; dm: string }> {
    return this.mutex.run(user.id, async () => {
      const member = await this.target(user, moderatorId, PermissionFlagsBits.ModerateMembers, true);
      if (!member?.moderatable) throw new UserError('Discord does not allow GOAT to change this member’s timeout.');
      const row = this.createCase(user.id, moderatorId, 'unmute', reason, null);
      try { await member.timeout(null, row.audit_reason!); }
      catch (err) { this.ctx.db.run("UPDATE moderation_cases SET status='failed',error=? WHERE id=?", errorText(err), row.id); throw err; }
      this.ctx.db.run("UPDATE moderation_cases SET status='cancelled' WHERE guild_id=? AND user_id=? AND action='mute' AND status='active'", this.ctx.guild.id, user.id);
      this.ctx.db.run("UPDATE moderation_cases SET status='applied' WHERE id=?", row.id);
      const dm = await this.dm(user, row, 'Timeout Removed', 'Removed'); this.log(row);
      return { caseId: row.id, dm };
    });
  }
  async unban(userId: string, moderatorId: string, reason: string): Promise<number> {
    return this.mutex.run(userId, async () => {
      if (!/^\d{17,20}$/.test(userId)) throw new UserError('Enter a valid Discord user ID.');
      const row = this.createCase(userId, moderatorId, 'unban', reason, null);
      try { await this.ctx.guild.bans.remove(userId, row.audit_reason!); }
      catch (err) {
        this.ctx.db.run("UPDATE moderation_cases SET status='failed',error=? WHERE id=?", errorText(err), row.id);
        if (errorCode(err) === 10026) throw new UserError('This user is not banned.');
        throw err;
      }
      this.ctx.db.run("UPDATE moderation_cases SET status='cancelled' WHERE guild_id=? AND user_id=? AND action='ban' AND status='active'", this.ctx.guild.id, userId);
      this.ctx.db.run("UPDATE moderation_cases SET status='applied' WHERE id=?", row.id);
      const user = await this.ctx.client.users.fetch(userId).catch(() => undefined);
      if (user) await this.dm(user, row, 'Ban Removed', 'Removed');
      this.log(row); return row.id;
    });
  }
  async warn(user: User, moderatorId: string, reason: string): Promise<{ caseId: number; dm: string }> {
    await this.target(user, moderatorId, PermissionFlagsBits.ModerateMembers, true);
    const row = this.createCase(user.id, moderatorId, 'warn', reason, null);
    this.ctx.db.run("UPDATE moderation_cases SET status='applied' WHERE id=?", row.id);
    const dm = await this.dm(user, row, 'Warning Notice', 'Warning — no timeout applied'); this.log(row);
    return { caseId: row.id, dm };
  }
  async tick(): Promise<void> {
    if (this.busy || this.ctx.stopping) return;
    this.busy = true;
    try {
      await this.recoverPending();
      this.ctx.db.run("UPDATE moderation_cases SET status='expired' WHERE action='mute' AND status='active' AND expires_at<=?", Date.now());
      const expired = this.ctx.db.all<CaseRow>("SELECT * FROM moderation_cases WHERE guild_id=? AND action='ban' AND status='active' AND expires_at IS NOT NULL AND expires_at<=? AND retry_at<=?", this.ctx.guild.id, Date.now(), Date.now());
      for (const row of expired) await this.mutex.run(row.user_id, async () => {
        if (this.ctx.stopping) return;
        const fresh = this.ctx.db.get<CaseRow>('SELECT * FROM moderation_cases WHERE id=?', row.id)!;
        if (fresh.status !== 'active') return;
        try {
          const ban = await this.ctx.guild.bans.fetch(row.user_id);
          if (ban.reason !== row.audit_reason) {
            this.ctx.db.run("UPDATE moderation_cases SET status='superseded' WHERE id=?", row.id);
            this.ctx.logs.enqueue({ embeds: [goatEmbed('Temporary Ban Superseded', colors.orange).setDescription(`Case #${row.id} was not automatically unbanned because the current ban belongs to a different moderation action.`).toJSON()] }, `ban-superseded:${row.id}`);
            return;
          }
          await this.ctx.guild.bans.remove(row.user_id, `GOAT • Temporary ban case #${row.id} expired`);
          this.ctx.db.run("UPDATE moderation_cases SET status='expired',error=NULL WHERE id=?", row.id);
          this.ctx.logs.enqueue({ embeds: [goatEmbed('Temporary Ban Expired', colors.green).setDescription(`<@${row.user_id}> was automatically unbanned.`)
            .addFields({ name: 'Case', value: `#${row.id}` }, { name: 'Original Reason', value: clip(row.reason, 1000) }).toJSON()] }, `ban-expired:${row.id}`);
        } catch (err) {
          if (errorCode(err) === 10026) this.ctx.db.run("UPDATE moderation_cases SET status='expired' WHERE id=?", row.id);
          else { this.ctx.db.run('UPDATE moderation_cases SET retry_at=?,error=? WHERE id=?', Date.now() + 60_000, errorText(err), row.id); this.ctx.logger.warn({ caseId: row.id, error: errorText(err) }, 'GOAT temporary unban will retry'); }
        }
      });
    } catch (err) { this.ctx.logger.error({ error: errorText(err) }, 'GOAT moderation worker failed'); }
    finally { this.busy = false; }
  }
  private async recoverPending(): Promise<void> {
    const rows = this.ctx.db.all<CaseRow>("SELECT * FROM moderation_cases WHERE guild_id=? AND status='pending' AND created_at<? AND retry_at<=? LIMIT 10", this.ctx.guild.id, Date.now() - 30_000, Date.now());
    for (const row of rows) await this.mutex.run(row.user_id, async () => {
      try {
        let status = 'failed';
        if (row.action === 'ban') {
          try { const b = await this.ctx.guild.bans.fetch(row.user_id); if (b.reason === row.audit_reason) status = 'active'; }
          catch (err) { if (errorCode(err) !== 10026) throw err; }
        } else if (row.action === 'mute') {
          const m = await this.ctx.guild.members.fetch({ user: row.user_id, force: true });
          if (m.communicationDisabledUntilTimestamp && row.expires_at && Math.abs(m.communicationDisabledUntilTimestamp - row.expires_at) <= 1000) status = 'active';
          else if (row.expires_at && row.expires_at < Date.now()) status = 'expired';
        } else if (row.action === 'warn') status = 'applied';
        else if (row.action === 'unmute') {
          const m = await this.ctx.guild.members.fetch({ user: row.user_id, force: true });
          if (!m.communicationDisabledUntilTimestamp) status = 'applied';
        } else if (row.action === 'unban') {
          try { await this.ctx.guild.bans.fetch(row.user_id); }
          catch (err) { if (errorCode(err) === 10026) status = 'applied'; else throw err; }
        }
        this.ctx.db.run('UPDATE moderation_cases SET status=?,error=NULL WHERE id=?', status, row.id);
        if (status !== 'failed') this.log(row);
      } catch (err) {
        if (errorCode(err) === 10007) this.ctx.db.run("UPDATE moderation_cases SET status='failed',error='Member no longer present' WHERE id=?", row.id);
        else this.ctx.db.run('UPDATE moderation_cases SET retry_at=?,error=? WHERE id=?', Date.now() + 60_000, errorText(err), row.id);
      }
    });
  }
}
