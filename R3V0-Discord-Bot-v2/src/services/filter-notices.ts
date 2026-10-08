import { createHash } from 'node:crypto';
import type { Message } from 'discord.js';
import type { Context, MessageSnapshot } from '../core/types.js';
import type { LinkViolation } from './link-filter.js';
import { noMentions } from '../core/embeds.js';
import { botMarker, snapshotMessage } from '../core/messages.js';
import { errorCode, errorText } from '../core/util.js';

interface Notice {
  message_id: string; channel_id: string; user_id: string; kind: LinkViolation['kind'];
  created_at: number; expires_at: number; state: string; attempts: number;
}
export function filterNoticeText(userId: string, kind: LinkViolation['kind'], providers: string[], allowedDomains: string[]): string {
  const names: Record<string, string> = { 'tenor.com': 'Tenor', 'giphy.com': 'Giphy', 'gph.is': 'Giphy', 'klipy.com': 'KLIPY' };
  const gifs = [...new Set(providers.map(domain => names[domain] ?? domain))].join(', ');
  const prefix = `<@${userId}> — `;
  if (kind === 'invite') return `${prefix}Discord invites are restricted.`;
  if (kind === 'gif') return `${prefix}Please use **${gifs}** for GIFs. YouTube, TikTok and Roblox links are also allowed.`;
  return `${prefix}This link is not allowed. Approved destinations: **${allowedDomains.join(', ')}**.`;
}
/** Public feedback is short, coalesced per member/channel and expires instead of arriving hours late. */
export class FilterNoticeService {
  private timer?: NodeJS.Timeout;
  private readonly inFlight = new Set<string>();
  private readonly activation: number;
  constructor(private readonly ctx: Context) {
    this.activation = Number(ctx.db.meta('filter_notices_started_at')) || ctx.startedAt || Date.now();
    ctx.db.setMeta('filter_notices_started_at', String(this.activation));
  }
  start(): void { this.timer = setInterval(() => { void this.tick(); }, 500); }
  stop(): void { if (this.timer) clearInterval(this.timer); }
  enqueue(snapshot: MessageSnapshot, kind: LinkViolation['kind'], removedJobCreatedAt: number): void {
    const config = this.ctx.config.linkFilter.notifications;
    const now = Date.now();
    if (!config.enabled || removedJobCreatedAt < this.activation || now > removedJobCreatedAt + config.maxDelaySeconds * 1000) return;
    this.ctx.db.transaction(() => {
      const recent = this.ctx.db.get('SELECT 1 FROM filter_notices WHERE guild_id=? AND channel_id=? AND user_id=? AND state IN (\'pending\',\'publishing\',\'sent\') AND COALESCE(published_at,created_at)>? LIMIT 1',
        snapshot.guildId, snapshot.channelId, snapshot.authorId, now - config.cooldownSeconds * 1000);
      this.ctx.db.run(`INSERT OR IGNORE INTO filter_notices(message_id,guild_id,channel_id,user_id,kind,state,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)`,
        snapshot.id, snapshot.guildId, snapshot.channelId, snapshot.authorId, kind, recent ? 'coalesced' : 'pending', now,
        removedJobCreatedAt + config.maxDelaySeconds * 1000);
    });
    void this.tick();
  }
  pending(): number { return this.ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM filter_notices WHERE state IN ('pending','publishing')")!.n; }
  async tick(now = Date.now()): Promise<void> {
    if (this.ctx.stopping) return;
    try {
      const jobs = this.ctx.db.all<Notice>("SELECT * FROM filter_notices WHERE state IN ('pending','publishing') AND retry_at<=? ORDER BY created_at LIMIT 20", now);
      await Promise.all(jobs.filter(job => !this.inFlight.has(job.message_id)).slice(0, Math.max(0, 3 - this.inFlight.size)).map(job => this.publish(job, now)));
    } catch (err) { this.ctx.logger.error({ error: errorText(err) }, 'GOAT filter notice worker failed'); }
  }
  private async publish(job: Notice, now: number): Promise<void> {
    this.inFlight.add(job.message_id);
    try {
      const channel = await this.ctx.guild.channels.fetch(job.channel_id);
      if (!channel?.isTextBased() || !('send' in channel)) throw new Error('Filter notice channel is not accessible.');
      const nonce = createHash('sha256').update(`filter-notice:${job.message_id}`).digest('hex').slice(0, 24);
      let message: Message | undefined;
      if (job.state === 'publishing') {
        // A previous send may have succeeded before its checkpoint. Recover by the private nonce.
        let before: string | undefined;
        for (let pageNumber = 0; pageNumber < 5; pageNumber++) {
          const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}), cache: false });
          const list = [...page.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
          message = list.find(item => item.author.id === this.ctx.client.user?.id && item.nonce === nonce);
          if (message || !list.length || list.at(-1)!.createdTimestamp < job.created_at - 5000) break;
          before = list.at(-1)!.id;
        }
      }
      const config = this.ctx.config.linkFilter;
      if (!message && (!config.notifications.enabled || now >= job.expires_at)) {
        this.ctx.db.run("UPDATE filter_notices SET state='expired',error=NULL WHERE message_id=?", job.message_id); return;
      }
      if (this.ctx.stopping) return;
      if (!message) {
        this.ctx.db.run("UPDATE filter_notices SET state='publishing',error=NULL WHERE message_id=?", job.message_id);
        message = await channel.send({ content: filterNoticeText(job.user_id, job.kind, config.gifProviderDomains, config.allowedDomains),
          allowedMentions: { ...noMentions, users: [job.user_id] }, nonce, enforceNonce: true });
      }
      const sent = message;
      this.ctx.db.transaction(() => {
        this.ctx.temporary.schedule(sent.id, channel.id, sent.createdTimestamp + config.notifications.deleteAfterSeconds * 1000);
        this.ctx.db.recordMessage(botMarker(snapshotMessage(sent)), 'live');
        this.ctx.db.run("UPDATE filter_notices SET state='sent',published_id=?,published_at=?,error=NULL WHERE message_id=?", sent.id, sent.createdTimestamp, job.message_id);
      });
      // Recovered, expired warnings are removed immediately rather than getting another ten seconds.
      void this.ctx.temporary.tick();
    } catch (err) {
      if (errorCode(err) === 10003) this.ctx.db.run("UPDATE filter_notices SET state='expired',error=NULL WHERE message_id=?", job.message_id);
      else this.ctx.db.run('UPDATE filter_notices SET attempts=attempts+1,retry_at=?,error=? WHERE message_id=?',
        now + Math.min(10000, 1000 * 2 ** Math.min(job.attempts, 4)), errorText(err), job.message_id);
    } finally { this.inFlight.delete(job.message_id); }
  }
}
