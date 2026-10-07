import { AttachmentBuilder, type APIEmbed, type ActionRowBuilder, type ButtonBuilder, type MessageCreateOptions } from 'discord.js';
import type { Context } from '../core/types.js';
import { noMentions } from '../core/embeds.js';
import { errorText } from '../core/util.js';

export interface LogPayload {
  embeds: APIEmbed[];
  components?: ReturnType<ActionRowBuilder<ButtonBuilder>['toJSON']>[];
  files?: { name: string; base64: string }[];
}
interface OutboxRow { id: number; payload: string; attempts: number; }

/** Durable, serial delivery. Failed Discord requests do not drop audit evidence. */
export class LogService {
  private timer?: NodeJS.Timeout;
  private busy = false;
  constructor(private readonly ctx: Context) {}
  enqueue(payload: LogPayload, dedupeKey?: string): void {
    this.ctx.db.run('INSERT OR IGNORE INTO log_outbox(dedupe_key,payload,created_at) VALUES(?,?,?)', dedupeKey ?? null, JSON.stringify(payload), Date.now());
  }
  start(): void { this.timer = setInterval(() => { void this.flush(); }, 600); }
  stop(): void { if (this.timer) clearInterval(this.timer); }
  async flush(): Promise<void> {
    if (this.busy || this.ctx.stopping) return;
    this.busy = true;
    let row: OutboxRow | undefined;
    try {
      row = this.ctx.db.get<OutboxRow>("SELECT id,payload,attempts FROM log_outbox WHERE status='pending' AND next_attempt<=? ORDER BY id LIMIT 1", Date.now());
      if (!row) return;
      const channel = await this.ctx.guild.channels.fetch(this.ctx.config.channels.logs);
      if (!channel?.isTextBased() || !('send' in channel)) throw new Error('Log channel is not a sendable channel.');
      const p = JSON.parse(row.payload) as LogPayload;
      const payload: MessageCreateOptions = { embeds: p.embeds, components: p.components, allowedMentions: noMentions,
        nonce: `goat-log-${row.id}`, enforceNonce: true,
        files: p.files?.map(f => new AttachmentBuilder(Buffer.from(f.base64, 'base64'), { name: f.name })) };
      await channel.send(payload);
      this.ctx.db.run("UPDATE log_outbox SET status='sent',sent_at=?,error=NULL WHERE id=?", Date.now(), row.id);
    } catch (err) {
      if (row) {
        const delay = Math.min(300_000, 2000 * 2 ** Math.min(row.attempts, 8));
        this.ctx.db.run('UPDATE log_outbox SET attempts=attempts+1,next_attempt=?,error=? WHERE id=?', Date.now() + delay, errorText(err), row.id);
        this.ctx.logger.warn({ outboxId: row.id, error: errorText(err) }, 'GOAT log delivery will retry');
      } else this.ctx.logger.error({ error: errorText(err) }, 'GOAT log worker failed');
    }
    finally { this.busy = false; }
  }
  pending(): number { return this.ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM log_outbox WHERE status='pending'")!.n; }
}
export function textEvidence(name: string, text: string): { name: string; base64: string } {
  return { name, base64: Buffer.from(text, 'utf8').toString('base64') };
}
