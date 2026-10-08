import { EmbedBuilder, type AutocompleteInteraction, type ChatInputCommandInteraction } from 'discord.js';
import { z } from 'zod';
import { noMentions } from '../core/embeds.js';
import { clip, UserError } from '../core/util.js';

const categorySchema = z.enum(['pets','charms','eggs','items']);
const variantSchema = z.enum(['normal','golden','diamond']);
const cardSchema = z.object({
  key: z.string().max(130), id: z.string().regex(/^[a-z0-9-]{1,100}$/), name: z.string().min(1).max(180),
  category: categorySchema, rarity: z.enum(['Exclusive','Secret','Mythical','Legendary','Epic','Rare','Basic']),
  variant: variantSchema, supportsVariants: z.boolean(), image: z.string().max(2000).nullable(),
  value: z.number().finite().nonnegative().nullable(), display: z.string().min(1).max(80),
  priceStatus: z.enum(['priced','owner_choice','unpriced']), bestPct: z.number().finite().nullable(),
  eventBadge: z.string().max(80).nullable(), source: z.string().max(500).nullable(), map: z.string().max(500).nullable(),
  hatchChance: z.string().max(180).nullable(), exists: z.number().int().nonnegative().nullable(),
  dropSources: z.array(z.string().max(180)).max(12),
}).superRefine((card, ctx) => {
  if (card.key !== `${card.category}/${card.id}/${card.variant}` || (!card.supportsVariants && card.variant !== 'normal') ||
    (card.priceStatus === 'priced' ? card.value === null : card.value !== null) ||
    (card.priceStatus === 'owner_choice' && card.display !== 'O/C') || (card.priceStatus === 'unpriced' && card.display !== 'Not Price')) {
    ctx.addIssue({ code: 'custom', message: 'Inconsistent value API card.' });
  }
  if (card.image) {
    try {
      if (!card.image.startsWith('/assets/') || card.image.startsWith('//') || /[?#\\\u0000-\u001f]/.test(card.image) || decodeURIComponent(card.image).includes('..')) throw new Error();
    } catch { ctx.addIssue({ code: 'custom', message: 'Invalid value API image.' }); }
  }
});
export const valueFeedSchema = z.object({
  ok: z.literal(true), apiVersion: z.literal(1), revision: z.string().regex(/^[a-f0-9]{64}$/),
  updatedAt: z.string().datetime().nullable(), dateSource: z.string().max(80).nullable(),
  source: z.literal('/data/prices.js'), total: z.number().int().min(0).max(1000), items: z.array(cardSchema).max(1000),
}).superRefine((feed, ctx) => {
  if (feed.total !== feed.items.length || new Set(feed.items.map(item => item.key)).size !== feed.items.length) {
    ctx.addIssue({ code: 'custom', message: 'Incomplete or duplicate value API cards.' });
  }
});
export type ValueFeed = z.infer<typeof valueFeedSchema>;
export type ValueCard = ValueFeed['items'][number];
type Category = z.infer<typeof categorySchema>;
type Variant = z.infer<typeof variantSchema>;
const labels = { pets: 'Pets', charms: 'Charms', eggs: 'Eggs', items: 'Items', normal: 'Normal', golden: 'Golden', diamond: 'Diamond' };
const rarityColors = { Exclusive: 0xa66bff, Secret: 0xd8dde8, Mythical: 0xff4e9a, Legendary: 0xffd33f, Epic: 0x34d8ff, Rare: 0x7ef23a, Basic: 0x8f98a8 };
const normalize = (name: string) => name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const safeText = (text: string) => text.replace(/[\\*_`~|>]/g, '\\$&');

export function valueSiteUrl(value: string): URL {
  const url = new URL(value);
  if (!(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1','localhost'].includes(url.hostname)) ||
    url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('VALUE_SITE_URL must be the HTTPS root address of your value website.');
  return url;
}

export function valueEmbed(card: ValueCard, feed: ValueFeed, site: URL): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(rarityColors[card.rarity])
    .setTitle(clip(`${card.name}${card.variant === 'normal' ? '' : ` · ${labels[card.variant]}`}`, 256))
    .setURL(site.href).setDescription(`🎟️ **${safeText(card.display)}**${card.priceStatus === 'priced' ? ' tickets' : ''}`)
    .addFields({ name: 'Rarity', value: card.rarity, inline: true }, { name: 'Variant', value: labels[card.variant], inline: true },
      { name: 'Category', value: labels[card.category], inline: true });
  if (card.image) embed.setThumbnail(new URL(card.image, site).href);
  if (card.bestPct !== null) embed.addFields({ name: 'Power', value: `${card.bestPct}% Best Pet`, inline: true });
  if (card.eventBadge) embed.addFields({ name: 'Event', value: safeText(card.eventBadge), inline: true });
  const sources = card.dropSources.length ? card.dropSources.join(' • ') : card.source;
  if (sources) embed.addFields({ name: 'Source', value: clip(safeText(sources), 1000) });
  if (card.map) embed.addFields({ name: 'Map', value: clip(safeText(card.map), 1000), inline: true });
  if (card.hatchChance) embed.addFields({ name: 'Hatch Chance', value: safeText(card.hatchChance), inline: true });
  if (card.exists !== null) embed.addFields({ name: 'Exists', value: card.exists.toLocaleString('en-US'), inline: true });
  if (feed.updatedAt) {
    embed.addFields({ name: 'Values Updated', value: `<t:${Math.floor(Date.parse(feed.updatedAt) / 1000)}:R>` });
    embed.setTimestamp(new Date(feed.updatedAt)).setFooter({ text: 'Pet Universe Values · Value-list update' });
  } else embed.setFooter({ text: 'Pet Universe Values · Price update time unavailable' });
  return embed;
}

async function responseJson(response: Response): Promise<unknown> {
  const limit = 1_500_000;
  if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('API response too large.'); }
  const reader = response.body?.getReader(); if (!reader) throw new Error('Empty API response.');
  const decoder = new TextDecoder('utf-8', { fatal: true }); let text = '', size = 0;
  try {
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength;
      if (size > limit) throw new Error('API response too large.'); text += decoder.decode(chunk.value, { stream: true }); }
    return JSON.parse(text + decoder.decode());
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
}

export class ValueService {
  readonly site: URL;
  private feed?: ValueFeed;
  private expiresAt = 0;
  private retryAt = 0;
  private pending?: Promise<ValueFeed>;
  private etag?: string;
  private etagPath?: string;
  constructor(private settings: { enabled: boolean; siteUrl: string; cacheSeconds: number }, private fetcher: typeof fetch = fetch) {
    this.site = valueSiteUrl(settings.siteUrl);
  }
  start(): void { if (this.settings.enabled) void this.get().catch(() => undefined); }
  async get(force = false): Promise<ValueFeed> {
    if (!this.settings.enabled) throw new UserError('Value lookup is disabled in this bot.');
    if (this.pending) return this.pending;
    if (!force && this.feed && Date.now() < this.expiresAt) return this.feed;
    if (Date.now() < this.retryAt) throw new UserError('The value API is temporarily unavailable. Try again shortly.');
    this.pending = this.refresh().catch(() => { this.retryAt = Date.now() + 5000;
      throw new UserError('The value API is temporarily unavailable. Check that the API version of the website is deployed, then try again.'); });
    try { return await this.pending; } finally { this.pending = undefined; }
  }
  private async refresh(): Promise<ValueFeed> {
    const signal = AbortSignal.timeout(6000);
    const request = (path: string) => this.fetcher(new URL(path, this.site), { signal, redirect: 'manual',
      headers: { accept: 'application/json', 'cache-control': 'no-cache', ...(this.etag && this.etagPath === path ? { 'if-none-match': this.etag } : {}) } });
    let path = '/api/v1/values'; let response = await request(path);
    // Static JSON works on the owner's site even if Pages Functions are disabled.
    if (response.status === 404 || response.ok && !response.headers.get('content-type')?.includes('application/json')) {
      await response.body?.cancel(); path = '/api/v1/values.json'; response = await request(path);
    }
    if (response.status === 304 && this.feed && this.etagPath === path) { this.expiresAt = Date.now() + this.settings.cacheSeconds * 1000; return this.feed; }
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) { await response.body?.cancel(); throw new Error('API unavailable.'); }
    const candidate = valueFeedSchema.parse(await responseJson(response));
    this.feed = candidate; this.expiresAt = Date.now() + this.settings.cacheSeconds * 1000;
    this.etag = response.headers.get('etag') || undefined; this.etagPath = path; this.retryAt = 0;
    return candidate;
  }
  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    if (!this.settings.enabled) { await interaction.respond([]); return; }
    if (!this.feed || Date.now() >= this.expiresAt) {
      let timeout: NodeJS.Timeout | undefined;
      try { await Promise.race([this.get().catch(() => undefined), new Promise<void>(resolve => { timeout = setTimeout(resolve, 1200); })]); }
      finally { if (timeout) clearTimeout(timeout); }
    }
    const category = categorySchema.safeParse(interaction.options.getString('category') || 'pets');
    if (!category.success) { await interaction.respond([]); return; }
    const query = normalize(String(interaction.options.getFocused()));
    const rank = (card: ValueCard) => Math.min(...[normalize(card.name), normalize(card.id)].map(name =>
      !query ? 3 : name === query ? 0 : name.startsWith(query) ? 1 : name.includes(query) ? 2 : 9));
    const cards = (this.feed?.items || []).filter(card => card.category === category.data && card.variant === 'normal' && rank(card) < 9)
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, 25);
    await interaction.respond(cards.map(card => ({ name: clip(`${card.name} · ${card.rarity}`, 100), value: card.id })));
  }
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const feed = await this.get(true);
    const category = categorySchema.parse(interaction.options.getString('category') || 'pets') as Category;
    const variant = variantSchema.parse(interaction.options.getString('variant') || 'normal') as Variant;
    const input = interaction.options.getString('name', true).trim();
    const cards = feed.items.filter(card => card.category === category && card.variant === 'normal');
    // Canonical autocomplete IDs win; typed names must match exactly, never an arbitrary partial card.
    let matches = cards.filter(card => card.id === input);
    if (!matches.length) matches = cards.filter(card => normalize(card.name) === normalize(input) || normalize(card.id) === normalize(input));
    if (!matches.length) throw new UserError('No matching card. Start typing its name and choose a suggestion.');
    if (matches.length > 1) throw new UserError('This name matches multiple cards. Choose the exact card from autocomplete.');
    const item = feed.items.find(card => card.id === matches[0].id && card.category === category && card.variant === variant);
    if (!item) throw new UserError(`${matches[0].name} has no ${labels[variant]} variant. Choose Normal.`);
    await interaction.editReply({ embeds: [valueEmbed(item, feed, this.site)], allowedMentions: noMentions });
  }
}
