import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { AttachmentBuilder } from 'discord.js';
import type { Context } from '../core/types.js';
import { colors, goatEmbed, noMentions } from '../core/embeds.js';
import { errorCode, errorText, Mutex, UserError } from '../core/util.js';
import { VERSION } from '../core/version.js';
import type { SupportAvailability } from './support-hours.js';
import { supportAvailability } from './support-hours.js';

export const RULES_TITLE = 'GOAT · Community Rules';
export function rulesEmbeds(schedule?: Pick<SupportAvailability, 'hours' | 'timezone'>) {
  const availability = schedule?.hours === '24/7' ? 'Public Support is available 24/7.' : `Public Support opens daily from **${schedule?.hours ?? '3 PM–10 PM'} (${schedule?.timezone ?? 'Europe/Warsaw'})**; existing conversations remain available.`;
  return [
    goatEmbed(RULES_TITLE, colors.cyan).setTimestamp(null)
      .setDescription('Welcome to **GOAT** — a place to play, trade and grow together.\nTo keep this a safe, fun and friendly space for everyone, please read our guidelines. By participating, you agree to follow these server rules and the official Discord and Roblox rules.')
      .setImage('attachment://goat-banner.png')
      .addFields(
        { name: '01 · 🤝 Be Kind & Respectful', value: 'Treat every member with respect. Harassment, hate speech, discrimination, threats, targeted insults and bullying are not welcome. Disagree with ideas without attacking people.' },
        { name: '02 · 🔞 Keep Content Safe for Everyone', value: 'No sexual or NSFW content, gore, graphic violence or disturbing media. This applies to messages, images, links, usernames, avatars and voice chat.' },
        { name: '03 · 🚫 No Cross-Trading', value: 'Cross-game trades and trades involving real money, gift cards or off-platform rewards are not allowed in this server. Keep trades within the supported game and its official systems.' })
      .setFooter({ text: 'GOAT • Community Rules • 1/3' }),
    goatEmbed('Protect Your Account. Protect the Community.', colors.green).setTimestamp(null)
      .addFields(
        { name: '04 · 🛡️ Follow Platform Rules', value: 'Follow the official Discord and Roblox rules. Do not share cheats, exploit tools or methods to abuse bugs. Buying, selling or sharing accounts is not allowed here.\n[Discord Terms](https://discord.com/terms) · [Community Guidelines](https://discord.com/guidelines)\n[Roblox Terms of Use](https://en.help.roblox.com/hc/en-us/articles/115004647846-Roblox-Terms-of-Use)' },
        { name: '05 · 🔗 No Malicious Links or Phishing', value: 'Never post scam links, fake Roblox login pages, token or IP grabbers, malware or suspicious downloads. Staff will never ask for your password, account cookies, recovery codes or Discord token.' },
        { name: '06 · ⚠️ No Scams or Deception', value: 'Scamming, fake proofs, impersonation and deliberately misleading trades are forbidden, including scams against clanmates. Confirmed scams result in a permanent ban. Report concerns privately to staff with evidence.' })
      .setFooter({ text: 'GOAT • Community Rules • 2/3' }),
    goatEmbed('Keep GOAT a Great Place to Be.', colors.purple).setTimestamp(null)
      .addFields(
        { name: '07 · 💬 Use Channels Properly', value: 'Keep conversations in the correct channels. Avoid spam, repeated pings, floods and disruptive arguments. Advertising, unsolicited DMs and promotion require staff permission. Follow the server’s link and GIF rules.' },
        { name: '08 · 🔒 Respect Privacy', value: 'Do not share anyone’s private information, personal photos or private conversations without permission. Never threaten to expose someone. Do not impersonate staff, members or official Roblox representatives.' },
        { name: '09 · 🎫 Tickets & Clan Applications', value: `Use one ticket at a time and explain your issue clearly. ${availability} Staff can make an exception. Applications require honest information and your own screenshots.` },
        { name: '10 · 📣 Reports, Moderation & Appeals', value: 'Report problems privately with useful evidence. Follow staff instructions and do not evade warnings, mutes or bans. Staff may remove content and issue warnings, timeouts or bans based on severity. Ask politely through Support if you need a decision reviewed.' })
      .setDescription('**Thank you for helping us look after the community.**\nBe fair. Stay safe. Enjoy your time with GOAT. 🐐')
      .setFooter({ text: 'GOAT • Community Rules • 3/3' })
  ];
}

/** Maintain one bot-owned rules message. Saved IDs and a narrow recovery marker prevent duplicates. */
export class RulesService {
  private readonly mutex = new Mutex();
  private timer?: NodeJS.Timeout;
  private ready = false;
  private retryAt = 0;
  constructor(private readonly ctx: Context) {}
  start(): void {
    if (!this.ctx.config.rules.enabled) return;
    void this.tick();
    this.timer = setInterval(() => { void this.tick(); }, 30000);
  }
  stop(): void { if (this.timer) clearInterval(this.timer); }
  messageDeleted(id: string): void {
    if (id === this.ctx.db.meta('rules_message_id')) { this.ready = false; this.retryAt = 0; }
  }
  async tick(): Promise<void> {
    if (this.ready || this.ctx.stopping || !this.ctx.config.rules.enabled || Date.now() < this.retryAt) return;
    try { await this.ensure(); }
    catch (err) { this.ctx.logger.warn({ error: errorText(err) }, 'GOAT rules publication will retry; check channel permissions'); }
  }
  async ensure(force = false): Promise<string> {
    if (!this.ctx.config.rules.enabled) throw new UserError('Automatic rules publication is disabled.');
    return this.mutex.run('rules', async () => {
      try {
        const channel = await this.ctx.guild.channels.fetch(this.ctx.config.rules.channelId);
        if (!channel?.isTextBased() || !('send' in channel)) throw new UserError('The configured rules channel is unavailable.');
        let message;
        const id = this.ctx.db.meta('rules_message_id');
        if (id && this.ctx.db.meta('rules_channel_id') === channel.id) {
          try { message = await channel.messages.fetch(id); }
          catch (err) { if (errorCode(err) !== 10008) throw err; }
        }
        if (!message) {
          const recent = await channel.messages.fetch({ limit: 100 });
          message = [...recent.values()].find(m => m.author.id === this.ctx.client.user?.id && m.embeds[0]?.title === RULES_TITLE);
        }
        const embeds = rulesEmbeds(supportAvailability(this.ctx.config.tickets.supportHours, this.ctx.config.timezone));
        const signature = createHash('sha256').update(VERSION + JSON.stringify(embeds.map(e => e.toJSON()))).digest('hex');
        const payload = { embeds, files: [new AttachmentBuilder(resolve('assets/goat-banner.png'))], allowedMentions: noMentions };
        if (!message) {
          const nonce = this.ctx.db.meta('rules_send_nonce') || `gr-${randomUUID().slice(0, 18)}`;
          this.ctx.db.setMeta('rules_send_nonce', nonce);
          message = await channel.send({ ...payload, nonce, enforceNonce: true });
        }
        else if (force || this.ctx.db.meta('rules_signature') !== signature) await message.edit({ ...payload, attachments: [] });
        this.ctx.db.setMeta('rules_channel_id', channel.id);
        this.ctx.db.setMeta('rules_message_id', message.id);
        this.ctx.db.setMeta('rules_send_nonce', '');
        this.ctx.db.setMeta('rules_signature', signature);
        this.ready = true;
        return `https://discord.com/channels/${this.ctx.guild.id}/${channel.id}/${message.id}`;
      } catch (err) { this.ready = false; this.retryAt = Date.now() + 30000; throw err; }
    });
  }
}
