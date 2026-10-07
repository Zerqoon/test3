import { AttachmentBuilder, EmbedBuilder, type GuildTextBasedChannel, type Message } from 'discord.js';
import type { Context, MessageSnapshot } from '../core/types.js';
import { colors, goatEmbed, noMentions } from '../core/embeds.js';
import { evidence } from '../core/messages.js';
import { clip, errorCode, errorText, Mutex, stamp } from '../core/util.js';

interface ArchiveRow {
  source_id: string; author_id: string; snapshot: string; published_id: string | null;
  state: string; historical: number; attempts: number; created_at: number;
}
export interface ArchiveSteps {
  publishedId?: string;
  publish: () => Promise<string>;
  savePublication: (id: string) => void;
  deleteSource: () => Promise<void>;
  saveDeleted: () => void;
}
/** The original is never deleted until a successful copy has been durably recorded. */
export async function publishThenDelete(steps: ArchiveSteps): Promise<string> {
  const id = steps.publishedId ?? await steps.publish();
  steps.savePublication(id);
  await steps.deleteSource();
  steps.saveDeleted();
  return id;
}
export function archiveSource(message: Message): string | undefined {
  for (const embed of message.embeds) {
    const match = embed.footer?.text.match(/^GOAT • Username Archive • Source: (\d{17,20})$/);
    if (match) return match[1];
  }
  return undefined;
}
async function copyAttachment(url: string, maximum: number): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['cdn.discordapp.com', 'media.discordapp.net'].includes(parsed.hostname)) {
    throw new Error('Only Discord-hosted attachments can be copied. The original was preserved.');
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), redirect: 'error' });
  if (!response.ok || !response.body) throw new Error(`Attachment download failed (${response.status}). The original was preserved.`);
  if (Number(response.headers.get('content-length') ?? 0) > maximum) throw new Error('Attachment exceeds the configured copy limit.');
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maximum) { await reader.cancel(); throw new Error('Attachment exceeds the configured copy limit.'); }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

export class UsernameService {
  private readonly mutex = new Mutex();
  private timer?: NodeJS.Timeout;
  private busy = false;
  private historyReady = false;
  constructor(private readonly ctx: Context) {}
  prepare(s: MessageSnapshot, historical: boolean): void {
    if (s.bot) return;
    this.ctx.db.run(`INSERT OR IGNORE INTO username_archives(source_id,guild_id,author_id,snapshot,historical,created_at)
      VALUES(?,?,?,?,?,?)`, s.id, s.guildId, s.authorId, JSON.stringify(s), historical ? 1 : 0, Date.now());
  }
  reconcile(message: Message): void {
    if (message.author.id !== this.ctx.client.user?.id || message.channelId !== this.ctx.config.channels.usernames) return;
    const sourceId = archiveSource(message);
    if (!sourceId) return;
    if (!this.ctx.db.get('SELECT source_id FROM username_archives WHERE source_id=?', sourceId)) {
      const embed = message.embeds.find(e => e.footer?.text.endsWith(sourceId));
      const authorId = embed?.fields.find(f => f.name === 'Submitted By')?.value.match(/<@(\d{17,20})>/)?.[1];
      const createdAt = embed?.timestamp ? Date.parse(embed.timestamp) : NaN;
      if (embed && authorId && Number.isFinite(createdAt)) {
        const member = this.ctx.guild.members.cache.get(authorId);
        const recovered: MessageSnapshot = { id: sourceId, guildId: this.ctx.guild.id, channelId: message.channelId,
          authorId, username: member?.user.username ?? 'Unknown', displayName: embed.title ?? 'Member',
          avatarUrl: embed.thumbnail?.url ?? message.author.displayAvatarURL(), content: embed.description ?? '',
          attachments: [...message.attachments.values()].filter(a => !a.name.startsWith('goat-original-')).map(a => ({ id: a.id, url: a.url, name: a.name, size: a.size, contentType: a.contentType })),
          embeds: [], stickers: [], createdAt, editedAt: createdAt, bot: false };
        this.ctx.db.recordMessage(recovered, 'history');
        this.ctx.db.run("INSERT OR IGNORE INTO username_archives(source_id,guild_id,author_id,snapshot,published_id,state,historical,created_at) VALUES(?,?,?,?,?,'locked',1,?)",
          sourceId, recovered.guildId, authorId, JSON.stringify(recovered), message.id, Date.now());
      }
    }
    this.ctx.db.run("UPDATE username_archives SET published_id=?,state=CASE WHEN state IN ('locked','removed') THEN state ELSE 'published' END WHERE source_id=? AND published_id IS NULL", message.id, sourceId);
  }
  releaseHistory(): void { this.historyReady = true; }
  start(): void { this.timer = setInterval(() => { void this.tick(); }, 500); }
  stop(): void { if (this.timer) clearInterval(this.timer); }
  retryBlocked(): number {
    const result = this.ctx.db.run("UPDATE username_archives SET state=CASE WHEN published_id IS NULL THEN 'pending' ELSE 'published' END,attempts=0,next_attempt=0,error=NULL WHERE state='blocked'");
    return Number(result.changes);
  }
  private async channel(): Promise<GuildTextBasedChannel & { send: GuildTextBasedChannel['send'] }> {
    const c = await this.ctx.guild.channels.fetch(this.ctx.config.channels.usernames);
    if (!c?.isTextBased() || !('send' in c)) throw new Error('Username channel is not sendable.');
    return c;
  }
  private async findPublication(channel: GuildTextBasedChannel, row: ArchiveRow): Promise<string | undefined> {
    let before: string | undefined;
    for (;;) {
      const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}), cache: false });
      const list = [...messages.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
      for (const message of list) if (message.author.id === this.ctx.client.user?.id && archiveSource(message) === row.source_id) return message.id;
      if (!list.length || list.at(-1)!.createdTimestamp < row.created_at - 5000) return undefined;
      before = list.at(-1)!.id;
    }
  }
  async tick(): Promise<void> {
    if (this.busy || this.ctx.stopping) return;
    this.busy = true;
    try {
      const row = this.ctx.db.get<ArchiveRow>(`SELECT * FROM username_archives WHERE state IN ('pending','published') AND next_attempt<=?
        AND (historical=0 OR ?=1) ORDER BY historical ASC, json_extract(snapshot,'$.createdAt') ASC LIMIT 1`, Date.now(), this.historyReady ? 1 : 0);
      if (!row) return;
      await this.mutex.run(row.source_id, async () => { await this.convert(row); });
    } catch (err) { this.ctx.logger.error({ error: errorText(err) }, 'GOAT username worker failed'); }
    finally { this.busy = false; }
  }
  private async convert(row: ArchiveRow): Promise<void> {
    const s = JSON.parse(row.snapshot) as MessageSnapshot;
    try {
      const channel = await this.channel();
      let publishedId = row.published_id ?? undefined;
      if (!publishedId && row.attempts > 0) publishedId = await this.findPublication(channel, row);
      if (publishedId) {
        // A successful copy may have been manually removed. Do not destroy its source.
        try { await channel.messages.fetch(publishedId); }
        catch (err) { if (errorCode(err) === 10008) throw new Error('The archived copy no longer exists. The source was preserved.'); throw err; }
      }
      // Count attempts before network I/O, so restart recovery also covers a crashed send.
      this.ctx.db.run('UPDATE username_archives SET attempts=attempts+1 WHERE source_id=?', row.source_id);
      const archivedId = await publishThenDelete({
        publishedId,
        publish: async () => {
          const files: AttachmentBuilder[] = [];
          let total = 0;
          let firstImage: string | undefined;
          for (const [index, a] of s.attachments.entries()) {
            const limit = this.ctx.config.usernames.maxAttachmentBytes;
            if (a.size > limit) throw new Error('An attachment is too large to copy. The original was preserved.');
            const buffer = await copyAttachment(a.url, limit);
            total += buffer.length;
            if (total > this.ctx.config.usernames.maxTotalAttachmentBytes) throw new Error('Total attachments exceed the copy limit. The original was preserved.');
            const name = clip(`source_${index}_${a.name.replace(/[^\p{L}\p{N}._-]/gu, '_')}`, 90);
            files.push(new AttachmentBuilder(buffer, { name }));
            if (!firstImage && /\.(png|jpe?g|webp|gif)$/i.test(name)) firstImage = `attachment://${name}`;
          }
          if (s.content.length > 4000 || s.embeds.length || s.stickers.length) {
            if (files.length >= 10) throw new Error('The complete evidence needs another attachment slot. The original was preserved.');
            files.push(new AttachmentBuilder(Buffer.from(evidence(s)), { name: `goat-original-${s.id}.txt` }));
          }
          const embed = new EmbedBuilder().setTitle(clip(s.displayName, 256)).setThumbnail(s.avatarUrl).setColor(colors.cyan)
            .setDescription(clip(s.content || '*No text — see attached files or the evidence file.*', 4000))
            .addFields({ name: 'Submitted By', value: `<@${s.authorId}>\n\`${s.authorId}\``, inline: true },
              { name: 'Submitted', value: stamp(s.createdAt), inline: true })
            .setFooter({ text: `GOAT • Username Archive • Source: ${s.id}` }).setTimestamp(s.createdAt);
          if (firstImage) embed.setImage(firstImage);
          const posted = await channel.send({ embeds: [embed], files, allowedMentions: noMentions, nonce: s.id, enforceNonce: true });
          return posted.id;
        },
        savePublication: id => { this.ctx.db.run("UPDATE username_archives SET published_id=?,state='published',error=NULL WHERE source_id=?", id, s.id); },
        deleteSource: async () => {
          try { await channel.messages.delete(s.id); }
          catch (err) { if (errorCode(err) !== 10008) throw err; }
        },
        saveDeleted: () => {
          this.ctx.db.run("UPDATE username_archives SET state='locked',error=NULL WHERE source_id=?", s.id);
          this.ctx.db.markDeleted(s.id);
        }
      });
      if (!row.historical && this.ctx.config.usernames.logLiveConversions && !this.ctx.config.logging.ignoreRoutineBotActions) this.ctx.logs.enqueue({ embeds: [goatEmbed('Username Locked', colors.green)
        .setThumbnail(s.avatarUrl).setDescription(clip(s.content || '[Attachment-only submission]', 3500))
        .addFields({ name: 'Author', value: `<@${s.authorId}> • ${clip(s.displayName, 128)}\nID: \`${s.authorId}\`` },
          { name: 'Locked Copy', value: `[Open submission](https://discord.com/channels/${s.guildId}/${s.channelId}/${archivedId})` })
        .toJSON()] }, `username:${s.id}`);
    } catch (err) {
      const attempts = row.attempts + 1;
      const blocked = attempts >= 6;
      this.ctx.db.run("UPDATE username_archives SET state=CASE WHEN ?=1 THEN 'blocked' WHEN published_id IS NOT NULL THEN 'published' ELSE 'pending' END,next_attempt=?,error=? WHERE source_id=?",
        blocked ? 1 : 0, Date.now() + Math.min(300_000, 2000 * 2 ** attempts), errorText(err), s.id);
      this.ctx.logger.warn({ sourceId: s.id, error: errorText(err) }, 'GOAT username conversion preserved its source and will retry');
      if (blocked) this.ctx.logs.enqueue({ embeds: [goatEmbed('Username Needs Attention', colors.orange)
        .setDescription('GOAT could not finish copying this submission. It did not intentionally delete the source. Fix channel permissions or attachment limits, then use /username-retry.')
        .addFields({ name: 'Message ID', value: `\`${s.id}\`` }, { name: 'Details', value: clip(errorText(err), 1000) }).toJSON()] }, `username-blocked:${s.id}`);
    }
  }
  async remove(messageId: string, moderatorId: string, reason: string): Promise<void> {
    const row = this.ctx.db.get<ArchiveRow>('SELECT * FROM username_archives WHERE published_id=?', messageId);
    if (!row) throw new Error('That ID is not a GOAT username archive.');
    await this.mutex.run(row.source_id, async () => {
      const channel = await this.channel();
      this.ctx.db.run("UPDATE username_archives SET state='removed' WHERE source_id=?", row.source_id);
      try { await channel.messages.delete(messageId); }
      catch (err) {
        if (errorCode(err) !== 10008) { this.ctx.db.run('UPDATE username_archives SET state=? WHERE source_id=?', row.state, row.source_id); throw err; }
      }
      this.ctx.logs.enqueue({ embeds: [goatEmbed('Username Archive Removed', colors.orange)
        .addFields({ name: 'Moderator', value: `<@${moderatorId}>\n\`${moderatorId}\`` },
          { name: 'Author', value: `<@${row.author_id}>\n\`${row.author_id}\`` },
          { name: 'Reason', value: clip(reason, 1024) }, { name: 'Archive ID', value: `\`${messageId}\`` }).toJSON()] }, `username-remove:${messageId}`);
    });
  }
}
