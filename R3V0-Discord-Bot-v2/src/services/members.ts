import type { GuildMember, GuildTextBasedChannel } from 'discord.js';
import { createHash } from 'node:crypto';
import { PermissionFlagsBits } from 'discord.js';
import type { Context } from '../core/types.js';
import { goatEmbed, colors, noMentions } from '../core/embeds.js';
import { errorCode, errorText, Mutex } from '../core/util.js';

interface RoleJob { user_id: string; role_id: string; attempts: number; }
interface Arrival { user_id: string; joined_at: number; requested_at: number; }
export function usernameReminderText(userId: string): string {
  return `<@${userId}>, please post your Roblox **@username** here — the name after **@** on your Roblox profile, not your display name.`;
}

export class MemberService {
  private readonly mutex = new Mutex();
  private timer?: NodeJS.Timeout;
  private busy = false;
  private readonly cutoff: number;
  private syncUsers = new Set<string>();
  private assigned = 0;
  private rescanAt = 0;
  constructor(private readonly ctx: Context) {
    this.cutoff = Number(ctx.db.meta('username_reminder_started_at')) || Date.now();
    ctx.db.setMeta('username_reminder_started_at', String(this.cutoff));
  }
  start(): void { this.timer = setInterval(() => { void this.tick(); }, 500); }
  stop(): void { if (this.timer) clearInterval(this.timer); }
  requestInitialSync(): void { this.ctx.db.setMeta('member_rescan_pending', '1'); }
  initialize(members: Iterable<GuildMember>): number {
    let queued = 0;
    for (const member of members) {
      if (member.user.bot) continue;
      this.ctx.roleReminders.baseline(member);
      const joined = member.joinedTimestamp ?? 0;
      this.ctx.db.run('INSERT OR IGNORE INTO member_arrivals(guild_id,user_id,joined_at,eligible) VALUES(?,?,?,?)',
        this.ctx.guild.id, member.id, joined, joined >= this.cutoff ? 1 : 0);
      this.observe(member);
      if (this.ctx.config.autorole.syncExistingOnStartup && this.queueRole(member)) { this.syncUsers.add(member.id); queued++; }
    }
    return queued;
  }
  private queueRole(member: GuildMember): boolean {
    const config = this.ctx.config.autorole;
    if (!config.enabled || member.user.bot || member.roles.cache.has(config.roleId)) return false;
    this.ctx.db.run(`INSERT INTO autorole_jobs(guild_id,user_id,role_id,created_at) VALUES(?,?,?,?)
      ON CONFLICT(guild_id,user_id,role_id) DO UPDATE SET status='pending',next_attempt=0,error=NULL,created_at=excluded.created_at`,
    this.ctx.guild.id, member.id, config.roleId, Date.now());
    return true;
  }
  onJoin(member: GuildMember): void {
    if (member.user.bot) return;
    this.ctx.db.run(`INSERT INTO member_arrivals(guild_id,user_id,joined_at,eligible) VALUES(?,?,?,1)
      ON CONFLICT(guild_id,user_id,joined_at) DO UPDATE SET eligible=1`, this.ctx.guild.id, member.id, member.joinedTimestamp ?? Date.now());
    this.queueRole(member);
    this.observe(member);
  }
  observe(member: GuildMember): void {
    if (member.user.bot || !this.ctx.config.usernameReminder.enabled || !member.roles.cache.has(this.ctx.config.usernameReminder.roleId)) return;
    this.ctx.db.run(`UPDATE member_arrivals SET reminder_state='pending',requested_at=COALESCE(requested_at,?)
      WHERE guild_id=? AND user_id=? AND joined_at=? AND eligible=1 AND reminder_state='waiting'`,
    Date.now(), this.ctx.guild.id, member.id, member.joinedTimestamp ?? 0);
  }
  async syncRoles(): Promise<number> {
    const members = await this.ctx.guild.members.fetch();
    let count = 0;
    for (const member of members.values()) if (this.queueRole(member)) { this.syncUsers.add(member.id); count++; }
    return count;
  }
  private async assignRole(job: RoleJob, now: number): Promise<void> {
    try {
      const member = await this.ctx.guild.members.fetch({ user: job.user_id, force: true });
      if (member.user.bot) {
        this.finishRole(job, 'skipped'); return;
      }
      if (!member.roles.cache.has(job.role_id)) {
        const role = await this.ctx.guild.roles.fetch(job.role_id);
        const me = await this.ctx.guild.members.fetchMe();
        if (!role || role.managed || !me.permissions.has(PermissionFlagsBits.ManageRoles) || me.roles.highest.comparePositionTo(role) <= 0) {
          throw new Error('GOAT autorole: create the configured role and place it below the bot role. Manage Roles is required.');
        }
        await member.roles.add(job.role_id, 'GOAT • Autorole');
        if (this.syncUsers.has(member.id)) this.assigned++;
      }
      this.finishRole(job, 'done');
      this.observe(member);
    } catch (err) {
      if (errorCode(err) === 10007 || errorCode(err) === 10013) { this.finishRole(job, 'left'); return; }
      const retry = now + Math.min(300000, 5000 * 2 ** Math.min(job.attempts, 6));
      this.ctx.db.run('UPDATE autorole_jobs SET attempts=attempts+1,next_attempt=?,error=? WHERE guild_id=? AND user_id=? AND role_id=?',
        retry, errorText(err), this.ctx.guild.id, job.user_id, job.role_id);
      this.ctx.logger.debug({ userId: job.user_id, error: errorText(err) }, 'GOAT autorole remains queued');
    }
  }
  private finishRole(job: RoleJob, status: string): void {
    this.ctx.db.run('UPDATE autorole_jobs SET status=?,error=NULL WHERE guild_id=? AND user_id=? AND role_id=?', status, this.ctx.guild.id, job.user_id, job.role_id);
    this.syncUsers.delete(job.user_id);
    if (!this.syncUsers.size && this.assigned) {
      this.ctx.logs.enqueue({ embeds: [goatEmbed('Autorole Sync Complete', colors.green)
        .setDescription(`Assigned <@&${job.role_id}> to **${this.assigned}** existing members.`).toJSON()] });
      this.assigned = 0;
    }
  }
  private async usernameChannel(): Promise<GuildTextBasedChannel> {
    const channel = await this.ctx.guild.channels.fetch(this.ctx.config.channels.usernames);
    if (!channel?.isTextBased() || !('send' in channel)) throw new Error('GOAT username channel is unavailable.');
    return channel;
  }
  private async remind(arrival: Arrival, now: number): Promise<void> {
    await this.mutex.run(`prompt:${arrival.user_id}:${arrival.joined_at}`, async () => {
      try {
        const member = await this.ctx.guild.members.fetch({ user: arrival.user_id, force: true });
        if (member.joinedTimestamp !== arrival.joined_at || member.user.bot) {
          this.ctx.db.run("UPDATE member_arrivals SET reminder_state='skipped' WHERE guild_id=? AND user_id=? AND joined_at=?", this.ctx.guild.id, arrival.user_id, arrival.joined_at); return;
        }
        if (!member.roles.cache.has(this.ctx.config.usernameReminder.roleId)) {
          this.ctx.db.run("UPDATE member_arrivals SET reminder_state='waiting',retry_at=0 WHERE guild_id=? AND user_id=? AND joined_at=?", this.ctx.guild.id, arrival.user_id, arrival.joined_at); return;
        }
        const channel = await this.usernameChannel();
        const text = usernameReminderText(member.id);
        let before: string | undefined;
        let message;
        // Reconcile a send interrupted before its database write without a second ping.
        for (;;) {
          const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}), cache: false });
          const list = [...page.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
          message = list.find(m => m.author.id === this.ctx.client.user?.id && (m.content === text || m.content === `${text} • GOAT`) && m.createdTimestamp >= arrival.requested_at - 5000);
          if (message || !list.length || list.at(-1)!.createdTimestamp < arrival.requested_at - 5000) break;
          before = list.at(-1)!.id;
        }
        message ??= await channel.send({ content: text, allowedMentions: { ...noMentions, users: [member.id] },
          nonce: createHash('sha256').update(`prompt:${member.id}:${arrival.joined_at}`).digest('hex').slice(0, 24), enforceNonce: true });
        const sent = message;
        this.ctx.db.transaction(() => {
          this.ctx.db.run('INSERT OR IGNORE INTO temporary_messages(message_id,channel_id,delete_at) VALUES(?,?,?)', sent.id, channel.id,
            sent.createdTimestamp + this.ctx.config.usernameReminder.deleteAfterSeconds * 1000);
          this.ctx.db.run("UPDATE member_arrivals SET reminder_state='sent',message_id=?,error=NULL WHERE guild_id=? AND user_id=? AND joined_at=?", sent.id, this.ctx.guild.id, arrival.user_id, arrival.joined_at);
        });
      } catch (err) {
        if (errorCode(err) === 10007 || errorCode(err) === 10013) {
          this.ctx.db.run("UPDATE member_arrivals SET reminder_state='skipped' WHERE guild_id=? AND user_id=? AND joined_at=?", this.ctx.guild.id, arrival.user_id, arrival.joined_at); return;
        }
        this.ctx.db.run('UPDATE member_arrivals SET retry_at=?,error=? WHERE guild_id=? AND user_id=? AND joined_at=?',
          now + 30000, errorText(err), this.ctx.guild.id, arrival.user_id, arrival.joined_at);
        this.ctx.logger.warn({ userId: arrival.user_id, error: errorText(err) }, 'GOAT username reminder will retry');
      }
    });
  }
  async tick(now = Date.now()): Promise<void> {
    if (!this.ctx.temporary.active) await this.ctx.temporary.tick(now);
    if (this.busy || this.ctx.stopping) return;
    this.busy = true;
    try {
      if (this.ctx.db.meta('member_rescan_pending') === '1' && now >= this.rescanAt) {
        try {
          const members = await this.ctx.guild.members.fetch();
          this.initialize(members.values());
          this.ctx.db.setMeta('member_rescan_pending', '0');
        } catch (err) {
          this.rescanAt = now + 60000;
          this.ctx.logger.warn({ error: errorText(err) }, 'GOAT full member sync will retry');
        }
      }
      if (this.ctx.config.autorole.enabled) {
        const role = this.ctx.db.get<RoleJob>("SELECT * FROM autorole_jobs WHERE guild_id=? AND status='pending' AND next_attempt<=? ORDER BY created_at LIMIT 1", this.ctx.guild.id, now);
        if (role) await this.assignRole(role, now);
      }
      if (this.ctx.config.usernameReminder.enabled) {
        const arrival = this.ctx.db.get<Arrival>("SELECT * FROM member_arrivals WHERE guild_id=? AND eligible=1 AND reminder_state='pending' AND retry_at<=? ORDER BY requested_at LIMIT 1", this.ctx.guild.id, now);
        if (arrival) await this.remind(arrival, now);
      }
    } catch (err) { this.ctx.logger.error({ error: errorText(err) }, 'GOAT member worker failed'); }
    finally { this.busy = false; }
  }
}
