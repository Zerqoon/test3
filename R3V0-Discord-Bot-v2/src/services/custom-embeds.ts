import { randomUUID } from 'node:crypto';
import { LabelBuilder, MessageFlags, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle,
  type ChatInputCommandInteraction, type MessageCreateOptions, type ModalSubmitInteraction } from 'discord.js';
import type { Context } from '../core/types.js';
import { requireStaff } from '../core/access.js';
import { colors, goatEmbed, noMentions } from '../core/embeds.js';
import { errorText, Mutex, UserError } from '../core/util.js';

export interface CustomEmbedInput { title: string; description: string; outside: string; image: string; color: string; }
interface EmbedDraft {
  id: string; guild_id: string; owner_id: string; channel_id: string; role_id: string | null; user_id: string | null;
  payload: string | null; message_id: string | null; state: string; expires_at: number; attempts: number;
}
export function customEmbedPayload(input: CustomEmbedInput, roleId?: string | null, userId?: string | null): MessageCreateOptions {
  const title = input.title.trim(), description = input.description.trim();
  if (!description) throw new UserError('Enter the embed message.');
  if (title.length > 249 || description.length > 4000 || input.outside.length > 1900) throw new UserError('The message is too long. Shorten it and try again.');
  let color: number = colors.cyan;
  if (input.color.trim()) {
    if (!/^#?[a-fA-F0-9]{6}$/.test(input.color.trim())) throw new UserError('Use a color such as #22D3EE.');
    color = Number.parseInt(input.color.trim().replace(/^#/, ''), 16);
  }
  const embed = goatEmbed(title || 'Announcement', color).setDescription(description).setTimestamp(null);
  if (input.image.trim()) {
    let url: URL;
    try { url = new URL(input.image.trim()); } catch { throw new UserError('Use a full HTTPS image URL.'); }
    if (url.protocol !== 'https:') throw new UserError('Use a full HTTPS image URL.');
    embed.setImage(url.href);
  }
  const outside = input.outside.trim();
  const mentions = [roleId ? `<@&${roleId}>` : '', userId ? `<@${userId}>` : ''].filter(mention => mention && !outside.includes(mention));
  const content = [...mentions.length ? [mentions.join(' ')] : [], ...outside ? [outside] : []].join('\n');
  return { content: content || undefined, embeds: [embed.toJSON()], allowedMentions: {
    ...noMentions, roles: roleId ? [roleId] : [], users: userId ? [userId] : []
  } };
}
export class EmbedService {
  private readonly mutex = new Mutex();
  private timer?: NodeJS.Timeout;
  private busy = false;
  constructor(private readonly ctx: Context) {}
  start(): void { this.timer = setInterval(() => { void this.tick(); }, 1000); }
  stop(): void { if (this.timer) clearInterval(this.timer); }
  private get(id: string): EmbedDraft | undefined { return this.ctx.db.get<EmbedDraft>('SELECT * FROM custom_embeds WHERE id=? AND guild_id=?', id, this.ctx.guild.id); }
  async create(interaction: ChatInputCommandInteraction): Promise<void> {
    const id = randomUUID();
    this.ctx.db.run('INSERT INTO custom_embeds(id,guild_id,owner_id,channel_id,role_id,user_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)',
      id, this.ctx.guild.id, interaction.user.id, interaction.options.getChannel('channel')?.id ?? interaction.channelId,
      interaction.options.getRole('ping-role')?.id ?? null, interaction.options.getUser('ping-user')?.id ?? null, Date.now(), Date.now() + 900000);
    const field = (name: string, label: string, maxLength: number, required = false, paragraph = false, placeholder?: string) => {
      const input = new TextInputBuilder().setCustomId(name).setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setRequired(required).setMaxLength(maxLength);
      if (placeholder) input.setPlaceholder(placeholder);
      return new LabelBuilder().setLabel(label).setTextInputComponent(input);
    };
    await interaction.showModal(new ModalBuilder().setCustomId(`goat:embed:modal:${id}`).setTitle('GOAT • Create Embed').addLabelComponents(
      field('title', 'Title', 249, false, false, 'Announcement'),
      field('description', 'Embed message', 4000, true, true, 'Write the message inside the embed.'),
      field('outside', 'Message outside the embed', 1900, false, true, 'Optional text above the embed. Selected pings are added automatically.'),
      field('image', 'Image URL', 2000, false, false, 'https://...'),
      field('color', 'Color', 7, false, false, '#22D3EE')));
  }
  async submit(interaction: ModalSubmitInteraction, id: string): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await requireStaff(interaction, this.ctx.config);
    await this.mutex.run(id, async () => {
      const draft = this.get(id);
      if (!draft || draft.owner_id !== interaction.user.id) throw new UserError('This form is unavailable. Use /embed again.');
      if (draft.state === 'published') {
        await interaction.editReply({ content: `Embed already published: https://discord.com/channels/${draft.guild_id}/${draft.channel_id}/${draft.message_id}`, allowedMentions: noMentions }); return;
      }
      if (draft.state !== 'draft') throw new UserError('This embed is already queued for delivery.');
      if (draft.expires_at < Date.now()) throw new UserError('This form has expired. Use /embed again.');
      const read = (name: string) => interaction.fields.getTextInputValue(name);
      const payload = customEmbedPayload({ title: read('title'), description: read('description'), outside: read('outside'), image: read('image'), color: read('color') }, draft.role_id, draft.user_id);
      this.ctx.db.run("UPDATE custom_embeds SET payload=?,state='publishing',retry_at=0 WHERE id=?", JSON.stringify(payload), id);
      try {
        await this.publish(this.get(id)!);
      } catch (err) {
        this.retry(id, err);
        await interaction.editReply({ content: 'Your embed is saved and queued. GOAT will retry delivery; check the destination channel permissions.', allowedMentions: noMentions }); return;
      }
      const saved = this.get(id)!;
      await interaction.editReply({ content: `Embed published: https://discord.com/channels/${saved.guild_id}/${saved.channel_id}/${saved.message_id}`, allowedMentions: noMentions });
    });
  }
  private async publish(draft: EmbedDraft): Promise<void> {
    const channel = await this.ctx.guild.channels.fetch(draft.channel_id);
    if (!channel?.isTextBased() || !('send' in channel)) throw new Error('The embed destination channel is unavailable.');
    if (draft.role_id) {
      const role = await this.ctx.guild.roles.fetch(draft.role_id);
      if (!role) throw new Error('The selected ping role no longer exists.');
      if (!role.mentionable && !channel.permissionsFor(this.ctx.client.user!.id)?.has(PermissionFlagsBits.MentionEveryone)) throw new Error('GOAT cannot ping that role. Make it mentionable or grant Mention Everyone to the bot.');
    }
    const nonce = `goat-embed-${draft.id.replace(/-/g, '').slice(0, 14)}`;
    this.ctx.db.run('UPDATE custom_embeds SET attempts=attempts+1 WHERE id=?', draft.id);
    const message = await channel.send({ ...JSON.parse(draft.payload!) as MessageCreateOptions, nonce, enforceNonce: true });
    this.ctx.db.run("UPDATE custom_embeds SET state='published',message_id=?,error=NULL,retry_at=0 WHERE id=?", message.id, draft.id);
  }
  private retry(id: string, err: unknown): void {
    this.ctx.db.run('UPDATE custom_embeds SET retry_at=?,error=? WHERE id=?', Date.now() + 30000, errorText(err), id);
    this.ctx.logger.warn({ embedId: id, error: errorText(err) }, 'GOAT custom embed will retry');
  }
  async tick(now = Date.now()): Promise<void> {
    if (this.busy || this.ctx.stopping) return;
    this.busy = true;
    try {
      for (const draft of this.ctx.db.all<EmbedDraft>("SELECT * FROM custom_embeds WHERE guild_id=? AND state='publishing' AND retry_at<=? ORDER BY created_at LIMIT 3", this.ctx.guild.id, now)) {
        await this.mutex.run(draft.id, async () => {
          const fresh = this.get(draft.id); if (fresh?.state !== 'publishing') return;
          try { await this.publish(fresh); } catch (err) { this.retry(draft.id, err); }
        });
      }
    } catch (err) { this.ctx.logger.error({ error: errorText(err) }, 'GOAT embed worker failed'); }
    finally { this.busy = false; }
  }
}
