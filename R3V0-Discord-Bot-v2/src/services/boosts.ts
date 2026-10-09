import { MessageType, type GuildMember, type Message, type PartialGuildMember, type User } from 'discord.js';
import type { Context } from '../core/types.js';
import { colors, goatEmbed } from '../core/embeds.js';
import { errorText } from '../core/util.js';
import type { LogPayload } from './logs.js';

const boostTypes = new Set<number>([MessageType.GuildBoost, MessageType.GuildBoostTier1, MessageType.GuildBoostTier2, MessageType.GuildBoostTier3]);
const CORRELATION_MS = 30000;
const FALLBACK_DELAY_MS = 20000;
interface BoostEvent { event_key: string; payload: string; state: string; }

export function boostEmbed(user: Pick<User, 'id' | 'displayAvatarURL'>, observedAt = Date.now()) {
  return goatEmbed('💎 Thank You for the Boost!', colors.cyan)
    .setDescription(`### A little boost. A big difference.\n\n<@${user.id}>, thank you for supporting **GOAT**!\nYour boost helps our community grow and makes this server an even better place to play, trade and spend time together.\n\n**We appreciate you being part of the clan.** 🐐`)
    .setThumbnail(user.displayAvatarURL({ extension: 'png', size: 256 }))
    .addFields({ name: '✨ Community Supporter', value: 'More possibilities for the server. More memories for everyone.\nThank you for helping GOAT reach the next level!' })
    .setFooter({ text: 'GOAT • Made stronger by our community' }).setTimestamp(observedAt);
}

/** First-boost member updates are a fallback; system messages also identify additional boosts. */
export class BoostService {
  private timer?: NodeJS.Timeout;
  constructor(private readonly ctx: Context) {}
  start(): void { if (this.ctx.config.boosts.enabled) this.timer = setInterval(() => this.tick(), 1000); }
  stop(): void { if (this.timer) clearInterval(this.timer); }
  transition(before: GuildMember | PartialGuildMember, after: GuildMember): void {
    if (!this.ctx.config.boosts.enabled || after.guild.id !== this.ctx.guild.id || after.user.bot || before.partial ||
      before.premiumSinceTimestamp !== null || !after.premiumSinceTimestamp || after.premiumSinceTimestamp < this.ctx.startedAt - 5000) return;
    const key = `boost-member:${after.guild.id}:${after.id}:${after.premiumSinceTimestamp}`;
    const at = after.premiumSinceTimestamp;
    const now = Date.now();
    this.ctx.db.transaction(() => {
      if (this.ctx.db.get('SELECT 1 FROM boost_events WHERE member_key=?', key)) return;
      const message = this.ctx.db.get<{ event_key: string }>(`SELECT event_key FROM boost_events WHERE guild_id=? AND user_id=?
        AND source='message' AND member_key IS NULL AND ABS(source_at-?)<=? ORDER BY source_at LIMIT 1`, after.guild.id, after.id, at, CORRELATION_MS);
      if (message) { this.ctx.db.run("UPDATE boost_events SET member_key=?,source='paired' WHERE event_key=?", key, message.event_key); return; }
      const payload: LogPayload = { channelId: this.ctx.config.boosts.channelId, embeds: [boostEmbed(after.user, at).toJSON()] };
      this.ctx.db.run(`INSERT OR IGNORE INTO boost_events(event_key,member_key,guild_id,user_id,source,source_at,payload,due_at,created_at)
        VALUES(?,?,?,?,'member',?,?,?,?)`, key, key, after.guild.id, after.id, at, JSON.stringify(payload), now + FALLBACK_DELAY_MS, now);
    });
  }
  message(message: Message): void {
    if (!this.ctx.config.boosts.enabled || message.guildId !== this.ctx.guild.id || !boostTypes.has(message.type) ||
      message.author.bot || message.webhookId || message.createdTimestamp < this.ctx.startedAt - 5000) return;
    const now = Date.now();
    this.ctx.db.transaction(() => {
      if (this.ctx.db.get('SELECT 1 FROM boost_events WHERE message_id=?', message.id)) return;
      const member = this.ctx.db.get<BoostEvent>(`SELECT event_key,payload,state FROM boost_events WHERE guild_id=? AND user_id=?
        AND source='member' AND message_id IS NULL AND ABS(source_at-?)<=? ORDER BY source_at LIMIT 1`, message.guildId, message.author.id, message.createdTimestamp, CORRELATION_MS);
      if (member) {
        this.ctx.db.run("UPDATE boost_events SET message_id=?,source='paired',due_at=? WHERE event_key=?", message.id, now, member.event_key);
        return;
      }
      const payload: LogPayload = { channelId: this.ctx.config.boosts.channelId, embeds: [boostEmbed(message.author, message.createdTimestamp).toJSON()] };
      this.ctx.db.run(`INSERT OR IGNORE INTO boost_events(event_key,guild_id,user_id,source,source_at,message_id,payload,due_at,created_at)
        VALUES(?,?,?,'message',?,?,?,?,?)`, `boost-message:${message.id}`, message.guildId, message.author.id, message.createdTimestamp, message.id, JSON.stringify(payload), now, now);
    });
    this.tick(now);
  }
  tick(now = Date.now()): void {
    if (this.ctx.stopping || !this.ctx.config.boosts.enabled) return;
    try {
      this.ctx.db.transaction(() => {
        for (const event of this.ctx.db.all<BoostEvent>("SELECT event_key,payload,state FROM boost_events WHERE guild_id=? AND state='waiting' AND due_at<=? ORDER BY due_at LIMIT 50", this.ctx.guild.id, now)) {
          const key = `boost-thanks:${event.event_key}`;
          this.ctx.logs.enqueue(JSON.parse(event.payload) as LogPayload, key);
          // Thank each supporter in a separate message, even when events arrive together.
          this.ctx.db.run('UPDATE log_outbox SET solo=1 WHERE dedupe_key=?', key);
          this.ctx.db.run("UPDATE boost_events SET state='queued' WHERE event_key=?", event.event_key);
        }
      });
    } catch (err) { this.ctx.logger.warn({ error: errorText(err) }, 'GOAT boost thank-you will retry'); }
  }
}
