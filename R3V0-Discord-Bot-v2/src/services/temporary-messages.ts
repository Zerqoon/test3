import type { Context } from '../core/types.js';
import { errorCode, errorText } from '../core/util.js';

interface TemporaryMessage { message_id: string; channel_id: string; }
/** Deletion runs independently of member fetches, DMs and the history importer. */
export class TemporaryMessageService {
  private timer?: NodeJS.Timeout;
  private readonly inFlight = new Set<string>();
  constructor(private readonly ctx: Context) {}
  get active(): boolean { return !!this.timer; }
  start(): void { this.timer = setInterval(() => { void this.tick(); }, 400); }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  schedule(messageId: string, channelId: string, deleteAt: number): void {
    this.ctx.db.run('INSERT OR IGNORE INTO temporary_messages(message_id,channel_id,delete_at) VALUES(?,?,?)', messageId, channelId, deleteAt);
  }
  async tick(now = Date.now()): Promise<void> {
    if (this.ctx.stopping) return;
    try {
      const jobs = this.ctx.db.all<TemporaryMessage>("SELECT * FROM temporary_messages WHERE status='pending' AND delete_at<=? AND retry_at<=? ORDER BY delete_at LIMIT 20", now, now);
      await Promise.all(jobs.filter(job => !this.inFlight.has(job.message_id)).slice(0, Math.max(0, 4 - this.inFlight.size)).map(job => this.remove(job, now)));
    } catch (err) { this.ctx.logger.error({ error: errorText(err) }, 'GOAT temporary message worker failed'); }
  }
  private async remove(job: TemporaryMessage, now: number): Promise<void> {
    this.inFlight.add(job.message_id);
    try {
      const channel = await this.ctx.guild.channels.fetch(job.channel_id);
      if (!channel?.isTextBased() || !('messages' in channel)) throw new Error('Temporary message channel is not accessible.');
      await channel.messages.delete(job.message_id);
      this.ctx.db.run("UPDATE temporary_messages SET status='deleted',error=NULL WHERE message_id=?", job.message_id);
    } catch (err) {
      if ([10008, 10003].includes(Number(errorCode(err)))) this.ctx.db.run("UPDATE temporary_messages SET status='deleted',error=NULL WHERE message_id=?", job.message_id);
      else this.ctx.db.run('UPDATE temporary_messages SET retry_at=?,error=? WHERE message_id=?', now + 10000, errorText(err), job.message_id);
    } finally { this.inFlight.delete(job.message_id); }
  }
}
