import type { GuildMember, Message, Role } from 'discord.js';
import type { Context, MessageSnapshot } from '../core/types.js';
import { allowed } from '../core/access.js';
import { evidence, gifMedia, snapshotMessage } from '../core/messages.js';
import { goatEmbed, colors, logButtons } from '../core/embeds.js';
import { clip, errorCode, errorText, safeText, UserError } from '../core/util.js';
import { textEvidence } from './logs.js';
import { logGifEvent } from './message-events.js';

export interface LinkViolation { kind: 'invite' | 'link' | 'gif'; reason: string; links: string[]; }
interface FilterJob {
  message_id: string; channel_id: string; snapshot: string; reason: string;
  state: string; attempts: number;
}
const gifDomains = ['tenor.com', 'giphy.com', 'gph.is'];
const domainIs = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** Inspect actual destinations, including masked Markdown URLs and bare domains. */
export function messageLinks(text: string): URL[] {
  const clean = text.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '');
  const pattern = /(?:[a-z][a-z\d+.-]*:\/\/|www\.)[^\s<>"'`]+|(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+(?:[\p{L}]{2,63}|xn--[a-z\d-]{2,63})(?::\d{1,5})?(?:[/?#][^\s<>"'`]*)?/giu;
  const links = new Map<string, URL>();
  for (const match of clean.matchAll(pattern)) {
    if (match.index && clean[match.index - 1] === '@' && !match[0].includes('://')) continue;
    const value = match[0].replace(/[.,;:!?\])}]+$/g, '');
    try {
      const url = new URL(value.includes('://') ? value : `https://${value}`);
      links.set(url.href, url);
    } catch { /* Invalid text is not a navigable URL. */ }
  }
  return [...links.values()];
}
export function isDiscordInvite(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  return domainIs(host, 'discord.gg') ||
    (['discord.com', 'discordapp.com'].some(domain => domainIs(host, domain)) &&
      /^\/invite(?:\/|$)/i.test(decodePath(url.pathname)));
}
function decodePath(path: string): string { try { return decodeURIComponent(path); } catch { return path; } }
function gifUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  return gifDomains.some(domain => domainIs(host, domain)) || /\.gifv?(?:$|\/)/i.test(decodePath(url.pathname)) ||
    (['cdn.discordapp.com', 'media.discordapp.net'].some(domain => domainIs(host, domain)) &&
      /^\/attachments\//i.test(url.pathname) && /(?:[?&](?:format|fm)=gif)(?:&|$)/i.test(url.search));
}
export function linkViolation(s: MessageSnapshot, options: {
  allowedDomains: string[]; blockInvites: boolean; staff: boolean; gifsAllowed: boolean;
}): LinkViolation | undefined {
  if (s.bot || options.staff) return;
  // Top-level embed URLs are destinations; preview thumbnails are Discord-generated resources.
  const links = messageLinks([s.content, ...s.embeds.map(embed => embed.url ?? '')].join('\n'));
  const invites = links.filter(isDiscordInvite);
  if (options.blockInvites && invites.length) return { kind: 'invite', reason: 'Discord invite links are restricted.', links: invites.map(url => url.href) };
  const gifLinks = links.filter(gifUrl);
  const media = gifMedia(s);
  const gifDestinations = new Set(s.embeds.filter(embed => embed.type === 'gifv')
    .flatMap(embed => [embed.url ?? '', embed.video?.url ?? '']).flatMap(value => messageLinks(value).map(url => url.href)));
  for (const file of s.attachments) {
    if (/^image\/gif(?:;|$)/i.test(file.contentType ?? '') || /\.gif$/i.test(file.name)) {
      for (const url of messageLinks(file.url)) gifDestinations.add(url.href);
    }
  }
  const hasGif = gifLinks.length || media.links.length || s.embeds.some(embed => embed.type === 'gifv');
  if (hasGif && !options.gifsAllowed) return { kind: 'gif', reason: 'GIFs require an approved role.',
    links: [...new Set([...gifLinks.map(url => url.href), ...media.links])] };
  const blocked = links.filter(url => {
    if (options.gifsAllowed && (gifUrl(url) || gifDestinations.has(url.href)) && (url.protocol === 'https:' || url.protocol === 'http:')) return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    return !['https:', 'http:'].includes(url.protocol) || !options.allowedDomains.some(domain => domainIs(host, domain));
  });
  if (blocked.length) return { kind: 'link', reason: 'This link destination is not allowed.', links: blocked.map(url => url.href) };
}

/** Live-only filtering; deletion jobs and role overrides survive Railway redeploys. */
export class LinkFilterService {
  private timer?: NodeJS.Timeout;
  private readonly inFlight = new Set<string>();
  constructor(private readonly ctx: Context) {}
  gifRoles(): string[] {
    const ids = new Set(this.ctx.config.linkFilter.gifAllowedRoleIds);
    for (const row of this.ctx.db.all<{ role_id: string; enabled: number }>('SELECT role_id,enabled FROM link_filter_roles WHERE guild_id=?', this.ctx.guild.id)) {
      if (row.enabled) ids.add(row.role_id); else ids.delete(row.role_id);
    }
    return [...ids];
  }
  setGifRole(role: Role, enabled: boolean, actorId: string): void {
    if (role.id === this.ctx.guild.id || role.managed) throw new UserError('Choose a regular member role.');
    this.ctx.db.run(`INSERT INTO link_filter_roles(guild_id,role_id,enabled,updated_by,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(guild_id,role_id) DO UPDATE SET enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
    this.ctx.guild.id, role.id, enabled ? 1 : 0, actorId, Date.now());
  }
  private inspect(s: MessageSnapshot, member?: GuildMember): LinkViolation | undefined {
    const staff = allowed(s.authorId, member?.roles.cache.keys() ?? [], this.ctx.config);
    const gifRoles = new Set(this.gifRoles());
    return linkViolation(s, { ...this.ctx.config.linkFilter, staff,
      gifsAllowed: staff || [...(member?.roles.cache.keys() ?? [])].some(role => gifRoles.has(role)) });
  }
  /** Returns true while a suspicious submission must be held instead of archived/reposted. */
  prepare(s: MessageSnapshot, recorded = false): boolean {
    if (!this.ctx.config.linkFilter.enabled || s.bot) return false;
    const violation = this.inspect(s);
    if (!violation) return false;
    if (!recorded) this.ctx.db.recordMessage(s, 'live');
    this.ctx.db.run(`INSERT INTO link_filter_jobs(message_id,guild_id,channel_id,snapshot,reason,created_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(message_id) DO UPDATE SET snapshot=excluded.snapshot,reason=excluded.reason,next_attempt=0,
        state=CASE WHEN link_filter_jobs.state IN ('deleted','removing') THEN link_filter_jobs.state ELSE 'pending' END`,
    s.id, s.guildId, s.channelId, JSON.stringify(s), violation.reason, Date.now());
    void this.run(s.id).catch(err => this.ctx.logger.error({ error: errorText(err) }, 'GOAT link filter failed'));
    return true;
  }
  start(): void { this.timer = setInterval(() => { void this.tick(); }, 500); }
  stop(): void { if (this.timer) clearInterval(this.timer); }
  pending(): number { return this.ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM link_filter_jobs WHERE state IN ('pending','removing')")!.n; }
  async tick(now = Date.now()): Promise<void> {
    if (this.ctx.stopping) return;
    try {
      const jobs = this.ctx.db.all<{ message_id: string }>("SELECT message_id FROM link_filter_jobs WHERE state IN ('pending','removing') AND next_attempt<=? ORDER BY created_at LIMIT 20", now);
      await Promise.all(jobs.slice(0, Math.max(0, 4 - this.inFlight.size)).map(job => this.run(job.message_id, now)));
    } catch (err) { this.ctx.logger.error({ error: errorText(err) }, 'GOAT link filter worker failed'); }
  }
  private release(s: MessageSnapshot): void {
    logGifEvent(this.ctx, s);
    if (s.channelId === this.ctx.config.channels.usernames && !this.ctx.db.get('SELECT 1 FROM messages WHERE id=? AND deleted_at IS NOT NULL', s.id)) {
      this.ctx.usernames.prepare(s, false);
    }
  }
  private async run(id: string, now = Date.now()): Promise<void> {
    if (this.ctx.stopping || this.inFlight.has(id) || this.inFlight.size >= 4) return;
    this.inFlight.add(id);
    const db = this.ctx.db;
    try {
      const job = db.get<FilterJob>("SELECT * FROM link_filter_jobs WHERE message_id=? AND state IN ('pending','removing')", id);
      if (!job) return;
      if (!this.ctx.config.linkFilter.enabled) {
        db.run("UPDATE link_filter_jobs SET state='cancelled',error=NULL WHERE message_id=?", id);
        this.release(JSON.parse(job.snapshot) as MessageSnapshot); return;
      }
      const channel = await this.ctx.guild.channels.fetch(job.channel_id);
      if (!channel?.isTextBased() || !('messages' in channel)) throw new Error('GOAT cannot access the message channel.');
      let message: Message;
      try { message = await channel.messages.fetch({ message: id, force: true, cache: false }); }
      catch (err) {
        if (errorCode(err) !== 10008) throw err;
        if (job.state === 'removing') this.finish(JSON.parse(job.snapshot) as MessageSnapshot, job.reason, true);
        else db.run("UPDATE link_filter_jobs SET state='absent',error=NULL WHERE message_id=?", id);
        return;
      }
      let current = snapshotMessage(message);
      let member: GuildMember | undefined;
      try { member = await this.ctx.guild.members.fetch({ user: current.authorId, force: true }); }
      catch (err) { if (errorCode(err) !== 10007) throw err; }
      if (this.ctx.stopping) return;
      const observed = db.snapshot(id);
      if (observed && observed.editedAt >= current.editedAt) current = observed;
      const violation = this.inspect(current, member);
      db.recordMessage(current, 'live');
      if (!violation) {
        db.run("UPDATE link_filter_jobs SET state='allowed',error=NULL WHERE message_id=?", id);
        this.release(current); return;
      }
      // Save before calling Discord. A concurrent Gateway delete uses this to avoid a second log.
      db.run("UPDATE link_filter_jobs SET state='removing',snapshot=?,reason=?,error=NULL WHERE message_id=?", JSON.stringify(current), violation.reason, id);
      await channel.messages.delete(id);
      this.finish(current, violation.reason, false);
    } catch (err) {
      const job = db.get<FilterJob>('SELECT * FROM link_filter_jobs WHERE message_id=?', id);
      if (job) db.run('UPDATE link_filter_jobs SET attempts=attempts+1,next_attempt=?,error=? WHERE message_id=?',
        now + Math.min(300000, 2000 * 2 ** Math.min(job.attempts, 8)), errorText(err), id);
      this.ctx.logger.warn({ messageId: id, error: errorText(err) }, 'GOAT link deletion will retry; check Manage Messages and channel access');
    } finally { this.inFlight.delete(id); }
  }
  private finish(s: MessageSnapshot, reason: string, recovered: boolean): void {
    this.ctx.db.run("UPDATE link_filter_jobs SET state='deleted',error=NULL WHERE message_id=?", s.id);
    this.ctx.db.markDeleted(s.id);
    const embed = goatEmbed('Message Removed · Link Filter', colors.red).setThumbnail(s.avatarUrl)
      .setDescription(clip(s.content || '*GIF attachment*', 1800)).addFields(
        { name: 'Author', value: `<@${s.authorId}> • ${safeText(s.displayName, 100)}\nID: \`${s.authorId}\``, inline: true },
        { name: 'Channel', value: `<#${s.channelId}>`, inline: true },
        { name: 'Reason', value: reason },
        { name: 'Action', value: recovered ? 'Confirmed absent after a saved GOAT removal request.' : 'Deleted by GOAT.' });
    this.ctx.logs.enqueue({ channelId: this.ctx.config.channels.messageLogs, embeds: [embed.toJSON()],
      files: [textEvidence(`goat-filter-${s.id}.txt`, `${reason}\n\n${evidence(s)}`)],
      components: logButtons(s.guildId, s.channelId, s.authorId).map(row => row.toJSON()) }, `filter:${s.id}`);
  }
}
