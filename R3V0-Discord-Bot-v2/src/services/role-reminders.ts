import { createHash } from 'node:crypto';
import { ActionRowBuilder, AuditLogEvent, ButtonBuilder, ButtonStyle, type GuildAuditLogsEntry, type GuildMember, type PartialGuildMember } from 'discord.js';
import type { Context } from '../core/types.js';
import { goatEmbed, noMentions } from '../core/embeds.js';
import { errorCode, errorText } from '../core/util.js';
import { changeRoles } from './audit.js';

interface RoleState { has_role: number; observed_at: number; }
interface DmJob { user_id: string; role_id: string; created_at: number; attempts: number; }
interface RolePacket { t?: string; d?: { guild_id?: string; user?: { id?: string; bot?: boolean }; roles?: string[] }; }

/** A role grant triggers a DM; initial member lists never trigger a bulk notification. */
export class RoleReminderService {
  private timer?: NodeJS.Timeout;
  private readonly inFlight = new Set<string>();
  private readonly activation: number;
  private readonly sessionStarted: number;
  constructor(private readonly ctx: Context) {
    this.sessionStarted = ctx.startedAt ?? Date.now();
    this.activation = Number(ctx.db.meta('username_role_dm_started_at')) || this.sessionStarted;
    ctx.db.setMeta('username_role_dm_started_at', String(this.activation));
  }
  start(): void { this.timer = setInterval(() => { void this.tick(); }, 500); }
  stop(): void { if (this.timer) clearInterval(this.timer); }
  private state(userId: string): RoleState | undefined {
    return this.ctx.db.get<RoleState>('SELECT has_role,observed_at FROM member_role_state WHERE guild_id=? AND user_id=? AND role_id=?',
      this.ctx.guild.id, userId, this.ctx.config.roleUsernameDm.roleId);
  }
  private save(userId: string, hasRole: boolean, observedAt: number): void {
    this.ctx.db.run(`INSERT INTO member_role_state(guild_id,user_id,role_id,has_role,observed_at) VALUES(?,?,?,?,?)
      ON CONFLICT(guild_id,user_id,role_id) DO UPDATE SET has_role=excluded.has_role,observed_at=excluded.observed_at`,
    this.ctx.guild.id, userId, this.ctx.config.roleUsernameDm.roleId, hasRole ? 1 : 0, observedAt);
  }
  baseline(member: GuildMember): void {
    if (member.user.bot) return;
    const saved = this.state(member.id);
    // A background preload must not overwrite a role transition received in this session.
    if (saved && saved.observed_at >= this.sessionStarted) return;
    this.save(member.id, member.roles.cache.has(this.ctx.config.roleUsernameDm.roleId), this.sessionStarted - 1);
  }
  transition(before: GuildMember | PartialGuildMember, after: GuildMember): void {
    if (after.guild.id !== this.ctx.guild.id || after.user.bot) return;
    this.observe(after.id, [...after.roles.cache.keys()], before.partial ? undefined : before.roles.cache.has(this.ctx.config.roleUsernameDm.roleId));
  }
  onJoin(member: GuildMember): void {
    if (member.guild.id !== this.ctx.guild.id || member.user.bot) return;
    this.observe(member.id, [...member.roles.cache.keys()], false);
  }
  raw(packet: RolePacket): void {
    const data = packet.d;
    if (packet.t !== 'GUILD_MEMBER_UPDATE' || data?.guild_id !== this.ctx.guild.id || !data.user?.id || !Array.isArray(data.roles) || data.user.bot) return;
    const cached = this.ctx.guild.members.cache.get(data.user.id);
    if (cached?.user.bot) return;
    this.observe(data.user.id, data.roles, cached && !cached.partial ? cached.roles.cache.has(this.ctx.config.roleUsernameDm.roleId) : undefined);
  }
  private observe(userId: string, roles: string[], previous?: boolean): void {
    const role = this.ctx.config.roleUsernameDm.roleId;
    const saved = this.state(userId);
    const hadRole = previous ?? (saved ? !!saved.has_role : undefined);
    const hasRole = roles.includes(role);
    const now = Date.now();
    this.save(userId, hasRole, now);
    if (hasRole && hadRole === false) this.queue(userId, now);
    if (!hasRole) this.ctx.db.run("UPDATE role_username_dms SET state='waiting',retry_at=0,error=NULL WHERE guild_id=? AND user_id=? AND role_id=? AND state='pending'",
      this.ctx.guild.id, userId, role);
  }
  audit(entry: GuildAuditLogsEntry): void {
    if (entry.action !== AuditLogEvent.MemberRoleUpdate || !entry.targetId || entry.createdTimestamp < this.activation) return;
    const role = this.ctx.config.roleUsernameDm.roleId;
    if (entry.changes.some(change => change.key === '$add' && changeRoles(change.new).includes(role))) this.queue(entry.targetId, entry.createdTimestamp);
  }
  private queue(userId: string, grantedAt: number): void {
    if (!this.ctx.config.roleUsernameDm.enabled || grantedAt < this.activation) return;
    this.ctx.db.run(`INSERT INTO role_username_dms(guild_id,user_id,role_id,created_at) VALUES(?,?,?,?)
      ON CONFLICT(guild_id,user_id,role_id) DO UPDATE SET
        state=CASE WHEN role_username_dms.state='waiting' THEN 'pending' ELSE role_username_dms.state END,
        retry_at=CASE WHEN role_username_dms.state='waiting' THEN 0 ELSE role_username_dms.retry_at END`,
    this.ctx.guild.id, userId, this.ctx.config.roleUsernameDm.roleId, grantedAt);
    void this.tick();
  }
  counts(): { pending: number; sent: number; closed: number } {
    const rows = this.ctx.db.all<{ state: string; n: number }>('SELECT state,COUNT(*) n FROM role_username_dms WHERE guild_id=? GROUP BY state', this.ctx.guild.id);
    const count = (state: string) => rows.find(row => row.state === state)?.n ?? 0;
    return { pending: count('pending'), sent: count('sent'), closed: count('closed') };
  }
  async tick(now = Date.now()): Promise<void> {
    if (this.ctx.stopping || !this.ctx.config.roleUsernameDm.enabled) return;
    try {
      const jobs = this.ctx.db.all<DmJob>("SELECT * FROM role_username_dms WHERE guild_id=? AND state='pending' AND retry_at<=? ORDER BY created_at LIMIT 20", this.ctx.guild.id, now);
      await Promise.all(jobs.filter(job => !this.inFlight.has(job.user_id)).slice(0, Math.max(0, 3 - this.inFlight.size)).map(job => this.deliver(job, now)));
    } catch (err) { this.ctx.logger.error({ error: errorText(err) }, 'GOAT role DM worker failed'); }
  }
  private async deliver(job: DmJob, now: number): Promise<void> {
    this.inFlight.add(job.user_id);
    const update = (state: string, error: string | null = null) => this.ctx.db.run('UPDATE role_username_dms SET state=?,error=? WHERE guild_id=? AND user_id=? AND role_id=?', state, error, this.ctx.guild.id, job.user_id, job.role_id);
    try {
      const stateBefore = this.state(job.user_id);
      const member = await this.ctx.guild.members.fetch({ user: job.user_id, force: true });
      if (member.user.bot) { update('skipped'); return; }
      if (!member.roles.cache.has(job.role_id)) { update('waiting'); return; }
      if (this.ctx.stopping) return;
      const user = await this.ctx.client.users.fetch(job.user_id);
      // Recheck the durable transition after potentially slow user/member requests.
      const latest = this.state(job.user_id);
      const pending = this.ctx.db.get<{ state: string }>('SELECT state FROM role_username_dms WHERE guild_id=? AND user_id=? AND role_id=?', this.ctx.guild.id, job.user_id, job.role_id);
      if (this.ctx.stopping || pending?.state !== 'pending') return;
      if (latest?.has_role === 0 && latest.observed_at !== stateBefore?.observed_at) { update('waiting'); return; }
      const embed = goatEmbed('Roblox Username Required').setDescription(
        `Please post your Roblox **@username** in <#${this.ctx.config.channels.usernames}>.\n\nUse the name shown after **@** on your Roblox profile, rather than your display name.`);
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setLabel('Open Username Channel')
        .setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${this.ctx.guild.id}/${this.ctx.config.channels.usernames}`));
      const message = await user.send({ embeds: [embed], components: [row], allowedMentions: noMentions,
        nonce: createHash('sha256').update(`role-username:${this.ctx.guild.id}:${job.user_id}:${job.role_id}:${job.created_at}`).digest('hex').slice(0, 24), enforceNonce: true });
      this.ctx.db.run("UPDATE role_username_dms SET state='sent',sent_at=?,message_id=?,error=NULL WHERE guild_id=? AND user_id=? AND role_id=?",
        Date.now(), message.id, this.ctx.guild.id, job.user_id, job.role_id);
    } catch (err) {
      const code = errorCode(err);
      if ([10007, 10013].includes(Number(code))) { update('waiting'); return; }
      if (code === 50007) { update('closed', 'Direct messages are disabled.'); return; }
      this.ctx.db.run('UPDATE role_username_dms SET attempts=attempts+1,retry_at=?,error=? WHERE guild_id=? AND user_id=? AND role_id=?',
        now + Math.min(300000, 2000 * 2 ** Math.min(job.attempts, 8)), errorText(err), this.ctx.guild.id, job.user_id, job.role_id);
      this.ctx.logger.debug({ userId: job.user_id, error: errorText(err) }, 'GOAT role DM will retry');
    } finally { this.inFlight.delete(job.user_id); }
  }
}
