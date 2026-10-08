import { createHash } from 'node:crypto';
import type { Message, PartialMessage } from 'discord.js';
import type { Context, MessageSnapshot } from '../core/types.js';
import { botMarker, completeMessage, evidence, gifMedia, rawSnapshot, snapshotMessage, updatedSnapshot, type RawMessageData } from '../core/messages.js';
import { colors, goatEmbed, logButtons } from '../core/embeds.js';
import { clip, errorText, safeText, stamp } from '../core/util.js';
import { textEvidence } from './logs.js';

function userFields(s: MessageSnapshot) {
  return [{ name: 'Author', value: `<@${s.authorId}> • ${safeText(s.displayName, 100)}\nID: \`${s.authorId}\``, inline: true },
    { name: 'Channel', value: `<#${s.channelId}>\nID: \`${s.channelId}\``, inline: true },
    { name: 'Message', value: `\`${s.id}\`\nSent ${stamp(s.createdAt, 'f')}`, inline: true }];
}
function sameContent(a: MessageSnapshot, b: MessageSnapshot): boolean {
  return a.content === b.content && JSON.stringify(a.attachments.map(file => [file.id, file.name])) === JSON.stringify(b.attachments.map(file => [file.id, file.name])) &&
    JSON.stringify(a.stickers) === JSON.stringify(b.stickers);
}
export function logGifEvent(ctx: Context, s: MessageSnapshot): void {
  if (!ctx.config.logging.logGifs || s.bot) return;
  const media = gifMedia(s); if (!media.links.length) return;
  const embed = goatEmbed('GIF Sent', colors.purple).setThumbnail(s.avatarUrl).setDescription(clip(s.content || '*GIF attachment*', 2000))
    .addFields(...userFields(s), { name: 'GIF / Media Links', value: clip(media.links.join('\n'), 1000) });
  if (media.preview?.startsWith('https://')) embed.setImage(media.preview);
  ctx.logs.enqueueLatest({ channelId: ctx.config.channels.messageLogs, embeds: [embed.toJSON()],
    files: s.content.length > 2000 ? [textEvidence(`goat-gif-${s.id}.txt`, evidence(s))] : undefined,
    components: logButtons(s.guildId, s.channelId, s.authorId, s.id).map(row => row.toJSON()) }, `gif:${s.id}`);
}

/** Raw Gateway events cover uncached channels/messages; high-level events remain a fallback. */
export class MessageEvents {
  private readonly rawSeen = new Map<string, number>();
  constructor(private readonly ctx: Context) {}
  private observed(event: string): void {
    this.ctx.db.setMeta(`message_${event}_observed_at`, String(Date.now()));
  }
  private remember(key: string): void {
    const now = Date.now(); this.rawSeen.set(key, now);
    if (this.rawSeen.size > 1000) for (const [id, at] of this.rawSeen) if (at < now - 5000) this.rawSeen.delete(id);
    if (this.rawSeen.size > 5000) this.rawSeen.delete(this.rawSeen.keys().next().value!);
  }
  private seen(key: string): boolean { return (this.rawSeen.get(key) ?? 0) > Date.now() - 5000; }
  private cached(id: string, channelId: string): MessageSnapshot | undefined {
    const saved = this.ctx.db.snapshot(id); if (saved) return saved;
    const channel = this.ctx.guild.channels.cache?.get(channelId);
    if (channel?.isTextBased() && 'messages' in channel) {
      const message = channel.messages.cache.get(id);
      if (message && !message.partial) return snapshotMessage(message);
    }
    return;
  }
  raw(packet: { t?: string | null; d?: unknown }): void {
    if (!packet.d || typeof packet.d !== 'object') return;
    const data = packet.d as RawMessageData & { ids?: string[] };
    if (!data.channel_id) return;
    const guildId = data.guild_id ?? (data.id ? this.ctx.db.snapshot(data.id)?.guildId : undefined) ?? this.ctx.guild.channels.cache?.get(data.channel_id)?.guildId;
    if (guildId !== this.ctx.guild.id) return;
    if (packet.t === 'MESSAGE_UPDATE' && data.id) {
      this.remember(`update:${data.id}`); this.observed('edit');
      if (data.author?.bot || data.webhook_id) return;
      const before = this.cached(data.id, data.channel_id);
      const after = rawSnapshot({ ...data, guild_id: guildId }, before);
      if (after) this.edit(before, after, !!data.edited_timestamp);
      else {
        if (data.edited_timestamp) this.unavailableEdit(data.id, data.channel_id, Date.parse(data.edited_timestamp), before, data.content);
        // Unknown author: fetch only this message for moderation, without delaying the log.
        void this.inspectUnknown(data.id, data.channel_id).catch(err => this.ctx.logger.warn({ error: errorText(err) }, 'GOAT could not inspect an uncached edit'));
      }
    } else if (packet.t === 'MESSAGE_DELETE' && data.id) {
      this.remember(`delete:${data.id}`); this.observed('delete');
      this.deleted(data.id, data.channel_id, this.cached(data.id, data.channel_id));
    } else if (packet.t === 'MESSAGE_DELETE_BULK' && Array.isArray(data.ids)) {
      const ids = data.ids.filter(id => typeof id === 'string');
      this.remember(`bulk:${data.channel_id}:${[...ids].sort()[0]}`); this.observed('delete');
      this.bulk(data.channel_id, ids.map(id => ({ id, snapshot: this.cached(id, data.channel_id) })));
    }
  }
  private async inspectUnknown(id: string, channelId: string): Promise<void> {
    if (!this.ctx.config.linkFilter.enabled || this.ctx.stopping) return;
    const channel = await this.ctx.guild.channels.fetch(channelId);
    if (!channel?.isTextBased() || !('messages' in channel)) return;
    const message = await channel.messages.fetch({ message: id, force: true, cache: false });
    if (this.ctx.stopping || message.author.bot || message.webhookId) return;
    const s = snapshotMessage(message); this.ctx.db.recordMessage(s, 'live'); this.ctx.linkFilter.prepare(s, true);
  }
  created(message: Message): void {
    if (message.guildId !== this.ctx.guild.id) return;
    const s = snapshotMessage(message);
    if (!s.bot && this.ctx.linkFilter.prepare(s)) return;
    this.ctx.history.ingest(message, 'live');
    logGifEvent(this.ctx, s);
  }
  async updated(old: Message | PartialMessage, incoming: Message | PartialMessage): Promise<void> {
    if (incoming.guildId !== this.ctx.guild.id || this.seen(`update:${incoming.id}`)) return;
    this.observed('edit');
    const before = this.ctx.db.snapshot(incoming.id) ?? (!old.partial ? snapshotMessage(old as Message) : undefined);
    let after = updatedSnapshot(incoming, before);
    if (!after) { const message = await completeMessage(incoming); if (message) after = snapshotMessage(message); }
    if (!after) { if (incoming.editedTimestamp) this.unavailableEdit(incoming.id, incoming.channelId, incoming.editedTimestamp, before, incoming.content); return; }
    this.edit(before, after, !!incoming.editedTimestamp);
  }
  private unavailableEdit(id: string, channelId: string, editedAt: number, before?: MessageSnapshot, content?: string | null): void {
    if (before?.bot || this.ctx.db.get('SELECT 1 FROM messages WHERE id=? AND deleted_at IS NOT NULL', id)) return;
    this.ctx.logs.enqueue({ channelId: this.ctx.config.channels.messageLogs, embeds: [goatEmbed('Message Edited', colors.orange)
      .setDescription('The edit was observed, but the complete message could not be retrieved.')
      .addFields({ name: 'Channel', value: `<#${channelId}>` }, { name: 'Message', value: `\`${id}\`` },
        { name: 'Before', value: clip(before?.content || '[Not observed before edit]', 1000) },
        { name: 'After', value: clip(content || '[Content unavailable]', 1000) }).toJSON()] }, `edit:${id}:${editedAt}:unavailable`);
  }
  private edit(before: MessageSnapshot | undefined, after: MessageSnapshot, explicitEdit: boolean): void {
    const ctx = this.ctx;
    if (after.bot) { ctx.db.recordMessage(botMarker(after), 'live'); return; }
    if ((before && after.editedAt < before.editedAt) || ctx.db.get('SELECT 1 FROM messages WHERE id=? AND deleted_at IS NOT NULL', after.id)) return;
    ctx.db.recordMessage(after, 'live');
    const held = ctx.linkFilter.prepare(after, true);
    if (!held && after.channelId === ctx.config.channels.usernames) ctx.usernames.prepare(after, false);
    if (!held) logGifEvent(ctx, after);
    if (before ? sameContent(before, after) : !explicitEdit) return;
    const embed = goatEmbed('Message Edited', colors.orange).setThumbnail(after.avatarUrl).addFields(...userFields(after),
      { name: 'Before', value: clip(before?.content || (before ? '[No text]' : '[Not observed before edit]'), 1000) },
      { name: 'After', value: clip(after.content || '[No text]', 1000) });
    const hash = createHash('sha256').update(JSON.stringify([after.content, after.attachments, after.stickers, after.editedAt])).digest('hex').slice(0, 16);
    if (JSON.stringify(before?.attachments) !== JSON.stringify(after.attachments) && (before?.attachments.length || after.attachments.length)) {
      embed.addFields({ name: 'Attachments', value: clip(after.attachments.map(file => `[${safeText(file.name, 80)}](${file.url})`).join('\n') || 'Removed', 900) });
    }
    ctx.logs.enqueue({ channelId: ctx.config.channels.messageLogs, embeds: [embed.toJSON()],
      files: (before?.content.length ?? 0) > 1000 || after.content.length > 1000 || before?.embeds.length || after.embeds.length || before?.stickers.length || after.stickers.length ?
        [textEvidence(`goat-edit-${after.id}.txt`, `${before ? evidence(before) : 'BEFORE: Not observed'}\n\nAFTER:\n${evidence(after)}`)] : undefined,
      components: logButtons(after.guildId, after.channelId, after.authorId, after.id).map(row => row.toJSON()) }, `edit:${after.id}:${hash}`);
  }
  deletedMessage(message: Message | PartialMessage): void {
    if (message.guildId !== this.ctx.guild.id || this.seen(`delete:${message.id}`)) return;
    this.observed('delete');
    this.deleted(message.id, message.channelId, this.ctx.db.snapshot(message.id) ?? (!message.partial ? snapshotMessage(message as Message) : undefined));
  }
  private ignoredDeletion(id: string, s?: MessageSnapshot): boolean {
    const db = this.ctx.db;
    return !!(s?.bot || db.get('SELECT 1 FROM username_archives WHERE source_id=? AND published_id IS NOT NULL', id) ||
      db.get('SELECT 1 FROM temporary_messages WHERE message_id=?', id) ||
      db.get('SELECT 1 FROM tickets WHERE opening_message_id=?', id) || db.meta('ticket_panel_message_id') === id ||
      db.get("SELECT 1 FROM link_filter_jobs WHERE message_id=? AND state IN ('removing','deleted')", id));
  }
  private deleted(id: string, channelId: string, s?: MessageSnapshot): void {
    const ctx = this.ctx;
    if (s) ctx.db.recordMessage(s.bot ? botMarker(s) : s, 'live');
    ctx.db.markDeleted(id);
    if (this.ignoredDeletion(id, s)) return;
    const embed = goatEmbed('Message Deleted', colors.red);
    if (s) {
      embed.setThumbnail(s.avatarUrl).setDescription(clip(s.content || '*No text content*', 2800)).addFields(...userFields(s),
        { name: 'Deletion Attribution', value: ctx.audit.cachedDeletionAttribution(s.authorId, s.channelId, Date.now()) });
    } else embed.setDescription('Content unavailable — GOAT had not observed this message before it was deleted.')
      .addFields({ name: 'Message ID', value: `\`${id}\`` }, { name: 'Channel', value: `<#${channelId}>` });
    if (s?.attachments.length) embed.addFields({ name: 'Attachments', value: clip(s.attachments.map(file => `[${safeText(file.name, 80)}](${file.url})`).join('\n'), 900) });
    ctx.logs.enqueue({ channelId: ctx.config.channels.messageLogs, embeds: [embed.toJSON()],
      files: s && (s.content.length > 2800 || s.embeds.length || s.stickers.length || s.attachments.length) ? [textEvidence(`goat-deleted-${s.id}.txt`, evidence(s))] : undefined,
      components: logButtons(ctx.guild.id, channelId, s?.authorId).map(row => row.toJSON()) }, `delete:${id}`);
  }
  bulkMessages(channelId: string, messages: Iterable<Message | PartialMessage>): void {
    const list = [...messages]; const first = list.map(message => message.id).sort()[0];
    if (this.seen(`bulk:${channelId}:${first}`)) return;
    this.observed('delete');
    this.bulk(channelId, list.map(message => ({ id: message.id,
      snapshot: this.ctx.db.snapshot(message.id) ?? (!message.partial ? snapshotMessage(message as Message) : undefined) })));
  }
  private bulk(channelId: string, messages: { id: string; snapshot?: MessageSnapshot }[]): void {
    const records: string[] = []; let human = 0;
    for (const { id, snapshot: s } of messages) {
      if (s) this.ctx.db.recordMessage(s.bot ? botMarker(s) : s, 'live');
      this.ctx.db.markDeleted(id);
      if (this.ignoredDeletion(id, s)) continue;
      if (s) human++;
      records.push(s ? evidence(s) : `Message ${id}: content unavailable — not observed`);
    }
    if (!records.length) return;
    const first = messages.map(message => message.id).sort()[0];
    this.ctx.logs.enqueue({ channelId: this.ctx.config.channels.messageLogs,
      embeds: [goatEmbed('Messages Bulk Deleted', colors.red).setDescription(`${records.length} messages removed from <#${channelId}>.\n${human} human message snapshots are available in the evidence file.`)
        .addFields({ name: 'Attribution', value: 'Discord does not provide a per-message actor for a bulk deletion. Check the server audit log.' }).toJSON()],
      files: [textEvidence(`goat-bulk-${first}.txt`, records.join('\n\n--------------------\n\n'))],
      components: logButtons(this.ctx.guild.id, channelId).map(row => row.toJSON()) }, `bulk:${channelId}:${first}`);
  }
}
