import { AttachmentBuilder, GatewayIntentBits, type APIEmbed, type ActionRowBuilder, type ButtonBuilder, type MessageCreateOptions } from 'discord.js';
import type { Context } from '../core/types.js';
import { colors, goatEmbed, noMentions } from '../core/embeds.js';
import { clip, errorCode, errorText, stamp, UserError } from '../core/util.js';
import { VERSION } from '../core/version.js';
import { botMarker, snapshotMessage } from '../core/messages.js';

export interface LogPayload {
  embeds: APIEmbed[];
  channelId?: string;
  correlation?: { types: number[]; targetId: string; observedAt: number };
  components?: ReturnType<ActionRowBuilder<ButtonBuilder>['toJSON']>[];
  files?: { name: string; base64: string }[];
}
interface OutboxRow { id: number; payload: string; attempts: number; created_at: number; solo: number; }
interface BatchRow { id: number; channel_id: string; payload: string; attempts: number; }

export function embedCharacters(embeds: APIEmbed[]): number {
  return embeds.reduce((total, e) => total + (e.title?.length ?? 0) + (e.description?.length ?? 0) +
    (e.footer?.text.length ?? 0) + (e.author?.name.length ?? 0) +
    (e.fields?.reduce((n, field) => n + field.name.length + field.value.length, 0) ?? 0), 0);
}

/** Batches are frozen in SQLite before sending; retries keep identical contents. */
export class LogService {
  private timer?: NodeJS.Timeout;
  private readonly inFlight = new Set<string>();
  constructor(private readonly ctx: Context) {}
  enqueue(payload: LogPayload, dedupeKey?: string): void {
    this.ctx.db.run('INSERT OR IGNORE INTO log_outbox(dedupe_key,payload,created_at) VALUES(?,?,?)', dedupeKey ?? null, JSON.stringify(payload), Date.now());
  }
  enqueueLatest(payload: LogPayload, key: string): void {
    this.enqueue(payload, key);
    this.ctx.db.run("UPDATE log_outbox SET payload=? WHERE dedupe_key=? AND status='pending' AND batch_id IS NULL", JSON.stringify(payload), key);
  }
  delivered(key: string): boolean {
    return !!this.ctx.db.get("SELECT 1 FROM log_receipts WHERE dedupe_key=? UNION ALL SELECT 1 FROM log_outbox WHERE dedupe_key=? AND status='sent' LIMIT 1", key, key);
  }
  cancelFallback(types: readonly number[], targetId: string, at: number): void {
    const rows = this.ctx.db.all<OutboxRow>("SELECT * FROM log_outbox WHERE status='pending' AND batch_id IS NULL AND created_at>=?", at - 30000);
    for (const row of rows) {
      const correlation = (JSON.parse(row.payload) as LogPayload).correlation;
      if (correlation?.targetId === targetId && correlation.types.some(type => types.includes(type)) && Math.abs(correlation.observedAt - at) <= 10000) {
        this.ctx.db.run("UPDATE log_outbox SET status='superseded' WHERE id=? AND batch_id IS NULL", row.id);
      }
    }
  }
  start(): void { this.timer = setInterval(() => { void this.flush(); }, 250); }
  stop(): void { if (this.timer) clearInterval(this.timer); }
  private freeze(now: number): BatchRow | undefined {
    const blocked = new Set(this.ctx.db.all<{ channel_id: string }>("SELECT DISTINCT channel_id FROM log_batches WHERE status='pending'").map(row => row.channel_id));
    for (const channel of this.inFlight) blocked.add(channel);
    const candidates = this.ctx.db.all<OutboxRow>(`SELECT o.* FROM log_outbox o WHERE o.status='pending' AND o.batch_id IS NULL AND o.next_attempt<=?
      AND NOT EXISTS (SELECT 1 FROM log_batches b WHERE b.status='pending' AND b.channel_id=COALESCE(json_extract(o.payload,'$.channelId'),?))
      ORDER BY o.id LIMIT 500`, now, this.ctx.config.channels.logs)
      .filter(row => !blocked.has((JSON.parse(row.payload) as LogPayload).channelId ?? this.ctx.config.channels.logs));
    const first = candidates.find(row => now - row.created_at >= this.ctx.config.logging.batchWindowMs);
    if (!first || now - first.created_at < this.ctx.config.logging.batchWindowMs) return;
    const firstPayload = JSON.parse(first.payload) as LogPayload;
    const channelId = firstPayload.channelId ?? this.ctx.config.channels.logs;
    const result: LogPayload = { embeds: [], components: [], files: [] };
    const ids: number[] = [];
    const names = new Set<string>();
    for (const row of candidates) {
      const p = JSON.parse(row.payload) as LogPayload;
      if ((p.channelId ?? this.ctx.config.channels.logs) !== channelId) continue;
      if (ids.length && (first.solo || row.solo || result.embeds.length + p.embeds.length > this.ctx.config.logging.batchMaxEmbeds ||
        embedCharacters([...result.embeds, ...p.embeds]) > 5800 || result.files!.length + (p.files?.length ?? 0) > 10 ||
        [...result.files!, ...(p.files ?? [])].reduce((bytes, file) => bytes + file.base64.length * 0.75, 0) > 8000000 ||
        result.components!.length + (p.components?.length ?? 0) > 5 || p.files?.some(file => names.has(file.name)))) break;
      result.embeds.push(...p.embeds);
      result.components!.push(...(p.components ?? []));
      result.files!.push(...(p.files ?? []));
      for (const file of p.files ?? []) names.add(file.name);
      ids.push(row.id);
      if (result.embeds.length >= this.ctx.config.logging.batchMaxEmbeds) break;
    }
    return this.ctx.db.transaction(() => {
      const id = Number(this.ctx.db.run('INSERT INTO log_batches(channel_id,payload,created_at) VALUES(?,?,?)', channelId, JSON.stringify(result), now).lastInsertRowid);
      for (const rowId of ids) this.ctx.db.run('UPDATE log_outbox SET batch_id=? WHERE id=?', id, rowId);
      return this.ctx.db.get<BatchRow>('SELECT * FROM log_batches WHERE id=?', id)!;
    });
  }
  async flush(now = Date.now()): Promise<void> {
    if (this.ctx.stopping) return;
    const work: Promise<void>[] = [];
    // Independent channels progress even while another Discord route is rate limited.
    try {
      while (this.inFlight.size < 4) {
        const batch = this.ctx.db.all<BatchRow>("SELECT * FROM log_batches WHERE status='pending' AND next_attempt<=? ORDER BY id", now)
          .find(row => !this.inFlight.has(row.channel_id)) ?? this.freeze(now);
        if (!batch) break;
        this.inFlight.add(batch.channel_id);
        work.push(this.sendBatch(batch, now).finally(() => { this.inFlight.delete(batch.channel_id); }));
      }
    } catch (err) { this.ctx.logger.error({ error: errorText(err) }, 'GOAT log worker failed'); }
    await Promise.all(work);
  }
  private async sendBatch(batch: BatchRow, now: number): Promise<void> {
    try {
      const channel = await this.ctx.guild.channels.fetch(batch.channel_id);
      if (!channel?.isTextBased() || !('send' in channel)) throw new Error('Log channel is not a sendable channel.');
      const p = JSON.parse(batch.payload) as LogPayload;
      const payload: MessageCreateOptions = { embeds: p.embeds, components: p.components, allowedMentions: noMentions,
        nonce: `goat-log-${batch.id}`, enforceNonce: true,
        files: p.files?.map(f => new AttachmentBuilder(Buffer.from(f.base64, 'base64'), { name: f.name })) };
      const message = await channel.send(payload);
      this.ctx.db.transaction(() => {
        this.ctx.db.run("UPDATE log_batches SET status='sent',sent_at=?,message_id=?,error=NULL WHERE id=?", now, message.id, batch.id);
        this.ctx.db.run("UPDATE log_outbox SET status='sent',sent_at=?,error=NULL WHERE batch_id=?", now, batch.id);
        this.ctx.db.run("INSERT OR IGNORE INTO log_receipts(dedupe_key,message_id,sent_at) SELECT dedupe_key,?,? FROM log_outbox WHERE batch_id=? AND dedupe_key LIKE 'ticket-transcript:%'", message.id, now, batch.id);
      });
    } catch (err) {
      const code = errorCode(err);
      const badPayload = code === 50035 || code === 50006 || code === 40005 || (typeof err === 'object' && err !== null && 'status' in err && err.status === 413);
      if (badPayload) {
        const rows = this.ctx.db.all<{ id: number }>('SELECT id FROM log_outbox WHERE batch_id=?', batch.id);
        this.ctx.db.transaction(() => {
          this.ctx.db.run("UPDATE log_batches SET status=?,attempts=attempts+1,error=? WHERE id=?", rows.length > 1 ? 'superseded' : 'blocked', errorText(err), batch.id);
          if (rows.length > 1) this.ctx.db.run("UPDATE log_outbox SET batch_id=NULL,solo=1,next_attempt=0,attempts=attempts+1,error=? WHERE batch_id=?", errorText(err), batch.id);
          else this.ctx.db.run("UPDATE log_outbox SET status='blocked',attempts=attempts+1,error=? WHERE batch_id=?", errorText(err), batch.id);
        });
        this.ctx.logger.warn({ batchId: batch.id, channelId: batch.channel_id, error: errorText(err) }, rows.length > 1 ? 'GOAT invalid batch will be isolated into separate logs' : 'GOAT invalid log retained for repair; healthy logs can continue');
        return;
      }
      const retryAt = now + Math.min(300000, 2000 * 2 ** Math.min(batch.attempts, 8));
      this.ctx.db.transaction(() => {
        this.ctx.db.run('UPDATE log_batches SET attempts=attempts+1,next_attempt=?,error=? WHERE id=?', retryAt, errorText(err), batch.id);
        this.ctx.db.run('UPDATE log_outbox SET attempts=attempts+1,next_attempt=?,error=? WHERE batch_id=?', retryAt, errorText(err), batch.id);
      });
      this.ctx.logger.warn({ batchId: batch.id, channelId: batch.channel_id, error: errorText(err) }, 'GOAT log batch will retry');
    }
  }
  pending(): number { return this.ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM log_outbox WHERE status IN ('pending','blocked')")!.n; }
  health(): string {
    const failed = this.ctx.db.all<{ channel_id: string; error: string }>("SELECT channel_id,error FROM log_batches WHERE status IN ('pending','blocked') AND error IS NOT NULL ORDER BY id DESC LIMIT 4");
    return failed.length ? failed.map(row => `<#${row.channel_id}>: ${row.error.slice(0, 180)}`).join('\n') : 'No delivery error recorded.';
  }
  retryMessageLogs(): number {
    const id = this.ctx.config.channels.messageLogs;
    return this.ctx.db.transaction(() => {
      const count = this.ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM log_outbox o JOIN log_batches b ON b.id=o.batch_id WHERE b.channel_id=? AND b.status IN ('pending','blocked')", id)!.n;
      this.ctx.db.run("UPDATE log_outbox SET status='pending',next_attempt=0 WHERE batch_id IN (SELECT id FROM log_batches WHERE channel_id=? AND status IN ('pending','blocked'))", id);
      this.ctx.db.run("UPDATE log_batches SET status='pending',next_attempt=0 WHERE channel_id=? AND status IN ('pending','blocked')", id);
      return count;
    });
  }
  async messageStatus() {
    const id = this.ctx.config.channels.messageLogs;
    const embed = goatEmbed('Message Log Diagnostics').addFields({ name: 'Version', value: VERSION, inline: true },
      { name: 'Destination', value: `<#${id}>\n\`${id}\`` });
    const intent = this.ctx.client.options.intents;
    embed.addFields({ name: 'Requested Gateway Intents', value: `Guild Messages: ${intent.has(GatewayIntentBits.GuildMessages) ? 'enabled' : 'MISSING'}\nMessage Content: ${intent.has(GatewayIntentBits.MessageContent) ? 'enabled' : 'MISSING'}\nMessage Content must also be enabled in Developer Portal → Bot.` });
    try {
      const channel = await this.ctx.guild.channels.fetch(id);
      if (!channel?.isTextBased() || !('send' in channel)) throw new Error('The configured destination is not an accessible text channel.');
      const me = this.ctx.guild.members.me ?? await this.ctx.guild.members.fetchMe();
      const permissions = channel.permissionsFor(me);
      const required = ['ViewChannel', channel.isThread() ? 'SendMessagesInThreads' : 'SendMessages', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory'] as const;
      const missing = required.filter(permission => !permissions?.has(permission));
      embed.addFields({ name: 'Channel Access', value: missing.length ? `Missing: ${missing.join(', ')}` : 'Ready — channel permissions verified.' });
    } catch (err) { embed.setColor(colors.red).addFields({ name: 'Channel Access', value: clip(errorText(err), 900) }); }
    const queued = this.ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM log_outbox WHERE status IN ('pending','blocked') AND COALESCE(json_extract(payload,'$.channelId'),?)=?", this.ctx.config.channels.logs, id)!.n;
    embed.addFields({ name: 'Queued for This Channel', value: String(queued), inline: true });
    for (const [event, label] of [['edit', 'Last Edit Event'], ['delete', 'Last Delete Event']] as const) {
      const at = this.ctx.db.meta(`message_${event}_observed_at`);
      embed.addFields({ name: label, value: at ? stamp(Number(at), 'R') : 'None observed by this installation.', inline: true });
    }
    const failures = this.ctx.db.all<{ error: string; status: string }>("SELECT error,status FROM log_batches WHERE channel_id=? AND status IN ('pending','blocked') AND error IS NOT NULL ORDER BY id DESC LIMIT 3", id);
    embed.addFields({ name: 'Delivery', value: failures.length ? clip(failures.map(row => `${row.status}: ${row.error}`).join('\n'), 1000) : 'No delivery error recorded.' });
    return embed;
  }
  async testMessageLogs(actorId: string): Promise<string> {
    const id = this.ctx.config.channels.messageLogs;
    const channel = await this.ctx.guild.channels.fetch(id);
    if (!channel?.isTextBased() || !('send' in channel)) throw new UserError(`GOAT cannot access message log channel ${id}.`);
    const me = this.ctx.guild.members.me ?? await this.ctx.guild.members.fetchMe();
    const permissions = channel.permissionsFor(me);
    const required = ['ViewChannel', channel.isThread() ? 'SendMessagesInThreads' : 'SendMessages', 'EmbedLinks'] as const;
    const missing = required.filter(permission => !permissions?.has(permission));
    if (missing.length) throw new UserError(`Message log channel ${id}: missing ${missing.join(', ')}.`);
    const message = await channel.send({ allowedMentions: noMentions,
      embeds: [goatEmbed('Message Logs · Delivery Test', colors.green).setDescription('GOAT can deliver embeds to this message log channel.')
        .addFields({ name: 'Version', value: VERSION, inline: true }, { name: 'Requested By', value: `<@${actorId}>`, inline: true })] });
    this.ctx.db.recordMessage(botMarker(snapshotMessage(message)), 'live');
    return `https://discord.com/channels/${this.ctx.guild.id}/${id}/${message.id}`;
  }
}
export function textEvidence(name: string, text: string): { name: string; base64: string } {
  return { name, base64: Buffer.from(text, 'utf8').toString('base64') };
}
