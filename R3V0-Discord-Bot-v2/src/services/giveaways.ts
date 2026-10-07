import { randomBytes, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, LabelBuilder,
  ModalBuilder, RoleSelectMenuBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
  PermissionFlagsBits, type ChatInputCommandInteraction, type ModalSubmitInteraction,
  type ButtonInteraction, type GuildTextBasedChannel, type Message
} from 'discord.js';
import type { Context } from '../core/types.js';
import { colors, goatEmbed, noMentions } from '../core/embeds.js';
import { clip, errorCode, errorText, humanDuration, Mutex, parseDuration, periodStart, shuffle, stamp, UserError, type Period } from '../core/util.js';

export interface GiveawayRow {
  id: string; guild_id: string; channel_id: string; message_id: string | null;
  host_id: string; title: string; prize: string; description: string; role_id: string | null;
  winners: number; min_messages: number; period: Period; created_at: number; ends_at: number;
  duration_ms: number; state: string; dirty: number; last_update: number; error: string | null; retry_at: number;
  ended_by: string | null; cancel_reason: string | null;
}
interface DraftRow {
  id: string; owner_id: string; guild_id: string; channel_id: string; winners: number;
  min_messages: number; period: Period; values_json: string | null; status: string;
  giveaway_id: string | null; expires_at: number;
}
interface DraftValues { title: string; prize: string; duration: string; description: string; roleId?: string; durationMs?: number; }
interface DrawRow {
  giveaway_id: string; round: number; candidate_order: string; candidate_index: number;
  winners_json: string; complete: number; announced_id: string | null; dm_done: number; drawn_at: number;
}
export function giveawayModal(draftId: string, values?: DraftValues): ModalBuilder {
  const text = (id: string, label: string, placeholder: string, max: number, value?: string, paragraph = false, required = true) => {
    const input = new TextInputBuilder().setCustomId(id).setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setPlaceholder(placeholder).setMaxLength(max).setRequired(required);
    if (value) input.setValue(value);
    return new LabelBuilder().setLabel(label).setTextInputComponent(input);
  };
  const roles = new RoleSelectMenuBuilder().setCustomId('required_role').setMinValues(0).setMaxValues(1)
    .setRequired(false).setPlaceholder('Optional — choose the required role');
  if (values?.roleId) roles.setDefaultRoles(values.roleId);
  return new ModalBuilder().setCustomId(`goat:giveaway:modal:${draftId}`).setTitle('GOAT • Create Giveaway').addLabelComponents(
    text('title', 'Giveaway Title', 'GOAT Clan Giveaway', 160, values?.title),
    text('prize', 'Prize', 'What will the winner receive?', 240, values?.prize),
    text('duration', 'Duration', '1s / 10s / 1m / 1 minute / 1h 30m', 100, values?.duration),
    text('description', 'Description', 'Details, rules or a note from the host', 1500, values?.description, true, false),
    new LabelBuilder().setLabel('Required Role').setDescription('Only members with this role can enter. The role will be pinged.').setRoleSelectMenuComponent(roles)
  );
}
export function giveawayButtons(id: string, count: number, active: boolean): ActionRowBuilder<ButtonBuilder>[] {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`goat:giveaway:enter:${id}`).setLabel(active ? `Enter Giveaway • ${count}` : 'Giveaway Closed')
      .setStyle(active ? ButtonStyle.Success : ButtonStyle.Secondary).setEmoji('🎉').setDisabled(!active),
    new ButtonBuilder().setCustomId(`goat:giveaway:leave:${id}`).setLabel('Leave Giveaway').setStyle(ButtonStyle.Secondary).setDisabled(!active)
  )];
}
function draftButtons(id: string, publish = true): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (publish) row.addComponents(new ButtonBuilder().setCustomId(`goat:giveaway:publish:${id}`).setLabel('Publish Giveaway').setStyle(ButtonStyle.Success));
  row.addComponents(new ButtonBuilder().setCustomId(`goat:giveaway:edit:${id}`).setLabel('Edit Details').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`goat:giveaway:discard:${id}`).setLabel('Discard Draft').setStyle(ButtonStyle.Danger));
  return [row];
}

export class GiveawayService {
  private readonly mutex = new Mutex();
  private busy = false;
  private timer?: NodeJS.Timeout;
  constructor(private readonly ctx: Context) {}
  start(): void { this.timer = setInterval(() => { void this.tick(); }, 500); }
  stop(): void { if (this.timer) clearInterval(this.timer); }
  get(id: string): GiveawayRow {
    const g = this.ctx.db.get<GiveawayRow>('SELECT * FROM giveaways WHERE id=? AND guild_id=?', id, this.ctx.guild.id);
    if (!g) throw new UserError('Giveaway not found. Use /giveaway-list to find its ID.');
    return g;
  }
  private draft(id: string, userId: string): DraftRow {
    const d = this.ctx.db.get<DraftRow>('SELECT * FROM giveaway_drafts WHERE id=? AND guild_id=? AND owner_id=?', id, this.ctx.guild.id, userId);
    if (!d || (d.expires_at < Date.now() && d.status !== 'published')) throw new UserError('This draft expired or belongs to another host. Create a new giveaway.');
    if (d.status === 'discarded') throw new UserError('This draft was discarded.');
    return d;
  }
  async create(interaction: ChatInputCommandInteraction): Promise<void> {
    if ((interaction.options.getInteger('winners') ?? 1) > this.ctx.config.giveaways.maxWinners) throw new UserError(`GOAT allows at most ${this.ctx.config.giveaways.maxWinners} winners per giveaway.`);
    const id = randomBytes(6).toString('hex');
    const channelId = interaction.options.getChannel('channel')?.id ?? interaction.channelId;
    this.ctx.db.run('INSERT INTO giveaway_drafts(id,owner_id,guild_id,channel_id,winners,min_messages,period,expires_at) VALUES(?,?,?,?,?,?,?,?)',
      id, interaction.user.id, this.ctx.guild.id, channelId, interaction.options.getInteger('winners') ?? 1,
      interaction.options.getInteger('min-messages') ?? 0, interaction.options.getString('message-period') ?? 'all', Date.now() + 30 * 60_000);
    await interaction.showModal(giveawayModal(id));
  }
  async submit(interaction: ModalSubmitInteraction, id: string): Promise<void> {
    const d = this.draft(id, interaction.user.id);
    if (d.status === 'published' || d.status === 'publishing') throw new UserError('This draft has already been submitted for publication.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const roles = interaction.fields.getSelectedRoles('required_role', false);
    const roleId = roles?.firstKey();
    const values: DraftValues = { title: interaction.fields.getTextInputValue('title').trim(), prize: interaction.fields.getTextInputValue('prize').trim(),
      duration: interaction.fields.getTextInputValue('duration').trim(), description: interaction.fields.getTextInputValue('description').trim(), roleId };
    this.ctx.db.run("UPDATE giveaway_drafts SET values_json=?,status='draft',expires_at=? WHERE id=?", JSON.stringify(values), Date.now() + 30 * 60_000, id);
    try {
      if (!values.title || !values.prize) throw new UserError('Title and prize cannot be empty.');
      values.durationMs = parseDuration(values.duration, this.ctx.config.giveaways.maxDurationDays * 86_400_000);
      await this.validateChannel(d.channel_id, roleId);
      this.ctx.db.run("UPDATE giveaway_drafts SET values_json=?,status='review' WHERE id=?", JSON.stringify(values), id);
      const preview = goatEmbed('Giveaway Preview', colors.purple).setDescription(`**${values.title}**\n\n${values.description || 'Good luck, GOAT!'}\n\nThis giveaway is ready to publish.`)
        .setImage('attachment://goat-banner.png').addFields({ name: 'Prize', value: values.prize },
          { name: 'Duration', value: humanDuration(values.durationMs), inline: true }, { name: 'Winners', value: String(d.winners), inline: true },
          { name: 'Channel', value: `<#${d.channel_id}>`, inline: true }, { name: 'Required Role / Ping', value: roleId ? `<@&${roleId}>` : 'No role requirement' },
          { name: 'Activity Requirement', value: d.min_messages ? `${d.min_messages} messages • ${d.period}` : 'None' });
      await interaction.editReply({ embeds: [preview], files: [new AttachmentBuilder(resolve('assets/goat-banner.png'))], components: draftButtons(id), allowedMentions: noMentions });
    } catch (err) {
      if (!(err instanceof UserError)) throw err;
      await interaction.editReply({ embeds: [goatEmbed('Check Giveaway Details', colors.orange).setDescription(err.message)], components: draftButtons(id, false), allowedMentions: noMentions });
    }
  }
  async draftAction(interaction: ButtonInteraction, action: string, id: string): Promise<void> {
    const d = this.draft(id, interaction.user.id);
    if (action === 'edit') {
      if (!['draft', 'review'].includes(d.status)) throw new UserError('A published giveaway cannot be edited as a draft.');
      await interaction.showModal(giveawayModal(id, d.values_json ? JSON.parse(d.values_json) as DraftValues : undefined));
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (action === 'discard') {
      if (!['draft', 'review'].includes(d.status)) throw new UserError('A published giveaway cannot be discarded as a draft.');
      this.ctx.db.run("UPDATE giveaway_drafts SET status='discarded' WHERE id=?", id);
      await interaction.editReply({ embeds: [goatEmbed('Draft Discarded').setDescription('The giveaway was not published.')], allowedMentions: noMentions });
      return;
    }
    await this.mutex.run(`draft:${id}`, async () => {
      const fresh = this.draft(id, interaction.user.id);
      let giveawayId = fresh.giveaway_id;
      if (!giveawayId) {
        if (fresh.status !== 'review' || !fresh.values_json) throw new UserError('Complete the giveaway form first.');
        const values = JSON.parse(fresh.values_json) as DraftValues;
        await this.validateChannel(fresh.channel_id, values.roleId);
        const duration = parseDuration(values.duration, this.ctx.config.giveaways.maxDurationDays * 86_400_000);
        const now = Date.now();
        giveawayId = randomBytes(6).toString('hex');
        this.ctx.db.transaction(() => {
          this.ctx.db.run(`INSERT INTO giveaways(id,guild_id,channel_id,host_id,title,prize,description,role_id,winners,min_messages,period,created_at,ends_at,duration_ms)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, giveawayId!, this.ctx.guild.id, fresh.channel_id, fresh.owner_id, values.title, values.prize, values.description,
            values.roleId ?? null, fresh.winners, fresh.min_messages, fresh.period, now, now + duration, duration);
          this.ctx.db.run("UPDATE giveaway_drafts SET status='publishing',giveaway_id=? WHERE id=?", giveawayId!, id);
        });
      }
      const g = this.get(giveawayId);
      if (g.state === 'publishing') await this.mutex.run(g.id, () => this.publish(g));
      const done = this.get(g.id);
      await interaction.editReply({ embeds: [goatEmbed('Giveaway Published', colors.green).setDescription(`[Open giveaway](https://discord.com/channels/${done.guild_id}/${done.channel_id}/${done.message_id})`)], allowedMentions: noMentions });
    });
  }
  private async validateChannel(channelId: string, roleId?: string): Promise<GuildTextBasedChannel> {
    const c = await this.ctx.guild.channels.fetch(channelId);
    if (!c?.isTextBased() || !('send' in c)) throw new UserError('Choose a text channel where GOAT can send messages.');
    const me = await this.ctx.guild.members.fetchMe();
    const permissions = c.permissionsFor(me);
    const send = c.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
    if (!permissions?.has([PermissionFlagsBits.ViewChannel, send, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory])) {
      throw new UserError('GOAT needs View Channel, Send Messages, Embed Links, Attach Files and Read Message History in the selected channel.');
    }
    if (c.isThread() && (c.archived || c.locked)) throw new UserError('Choose an unlocked, active channel or thread.');
    if (roleId) {
      const role = await this.ctx.guild.roles.fetch(roleId);
      if (!role || role.id === this.ctx.guild.id) throw new UserError('Choose a valid server role.');
      if (!role.mentionable && !permissions.has(PermissionFlagsBits.MentionEveryone)) throw new UserError('GOAT cannot ping that role. Allow Mention Everyone for the bot, or make the role mentionable.');
    }
    return c;
  }
  private entries(id: string): number { return this.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM giveaway_entries WHERE giveaway_id=?', id)!.n; }
  private render(g: GiveawayRow) {
    const closed = g.state === 'ended' || g.state === 'cancelled';
    const embed = goatEmbed(g.state === 'cancelled' ? 'Giveaway Cancelled' : closed ? 'Giveaway Ended' : g.title, closed ? colors.orange : colors.cyan)
      .setDescription(`**Prize: ${g.prize}**\n\n${g.description || 'Enter below. Good luck, GOAT!'}`)
      .setImage('attachment://goat-banner.png').addFields({ name: 'Host', value: `<@${g.host_id}>`, inline: true },
        { name: 'Winners', value: String(g.winners), inline: true }, { name: 'Entries', value: String(this.entries(g.id)), inline: true },
        { name: closed ? 'Scheduled End' : 'Ends', value: `${stamp(g.ends_at, 'R')}\n${stamp(g.ends_at)}` },
        { name: 'Entry Requirements', value: `${g.role_id ? `<@&${g.role_id}>` : 'Open to server members'}${g.min_messages ? `\nAt least ${g.min_messages} ${g.period} messages` : ''}` });
    if (g.state === 'cancelled') embed.addFields({ name: 'Cancellation Reason', value: clip(g.cancel_reason ?? 'Cancelled by the host', 1000) });
    if (g.state === 'ended') {
      const draw = this.ctx.db.get<DrawRow>('SELECT * FROM giveaway_draws WHERE giveaway_id=? AND complete=1 ORDER BY round DESC LIMIT 1', g.id);
      const winners = draw ? JSON.parse(draw.winners_json) as string[] : [];
      embed.addFields({ name: 'Selected Winners', value: winners.map(id => `<@${id}>`).join(', ') || 'No eligible entries' });
    }
    return embed.setFooter({ text: `GOAT • Giveaway ID: ${g.id}` });
  }
  private async findMessage(channel: GuildTextBasedChannel, footer: string, since: number): Promise<Message | undefined> {
    let before: string | undefined;
    for (;;) {
      const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}), cache: false });
      const list = [...page.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
      const found = list.find(m => m.author.id === this.ctx.client.user?.id && m.embeds.some(e => e.footer?.text === footer));
      if (found) return found;
      if (!list.length || list.at(-1)!.createdTimestamp < since - 5000) return undefined;
      before = list.at(-1)!.id;
    }
  }
  private async publish(g: GiveawayRow): Promise<void> {
    const channel = await this.validateChannel(g.channel_id, g.role_id ?? undefined);
    let message = await this.findMessage(channel, `GOAT • Giveaway ID: ${g.id}`, g.created_at);
    if (!message) message = await channel.send({ content: g.role_id ? `<@&${g.role_id}>` : undefined,
      embeds: [this.render(g)], components: giveawayButtons(g.id, 0, true),
      files: [new AttachmentBuilder(resolve('assets/goat-banner.png'))], nonce: `goat-gw-${g.id}`, enforceNonce: true,
      allowedMentions: { ...noMentions, roles: g.role_id ? [g.role_id] : [] } });
    this.ctx.db.transaction(() => {
      this.ctx.db.run("UPDATE giveaways SET message_id=?,state='active',ends_at=?,dirty=1,error=NULL,retry_at=0 WHERE id=?", message.id, message.createdTimestamp + g.duration_ms, g.id);
      this.ctx.db.run("UPDATE giveaway_drafts SET status='published' WHERE giveaway_id=?", g.id);
      this.ctx.logs.enqueue({ embeds: [goatEmbed('Giveaway Created', colors.green).setDescription(`**${g.title}**\nPrize: ${g.prize}`)
        .addFields({ name: 'Host', value: `<@${g.host_id}>\n\`${g.host_id}\`` }, { name: 'Giveaway ID', value: `\`${g.id}\`` },
          { name: 'Requirement / Role Ping', value: g.role_id ? `<@&${g.role_id}>` : 'None' }, { name: 'Duration', value: humanDuration(g.duration_ms) }).toJSON()] }, `gw-created:${g.id}`);
    });
  }
  async entry(interaction: ButtonInteraction, id: string, leave: boolean): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const g = this.get(id);
    if (g.state !== 'active' || Date.now() >= g.ends_at) throw new UserError('This giveaway is already closed.');
    if (interaction.message.id !== g.message_id) throw new UserError('Use the entry buttons on the original giveaway message.');
    if (!leave) {
      const member = await this.ctx.guild.members.fetch({ user: interaction.user.id, force: true });
      if (member.user.bot) throw new UserError('Bots cannot enter giveaways.');
      if (g.role_id && !member.roles.cache.has(g.role_id)) throw new UserError('You do not have the role required for this giveaway.');
      if (g.min_messages && this.ctx.history.running) throw new UserError('Message history is still being imported. Try again once the import finishes.');
      const n = this.ctx.db.count(g.guild_id, member.id, periodStart(g.period, this.ctx.config.timezone));
      if (n < g.min_messages) throw new UserError(`You need ${g.min_messages} ${g.period} messages to enter. Your indexed total is ${n}.`);
    }
    const changed = this.ctx.db.transaction(() => {
      const fresh = this.get(id);
      if (fresh.state !== 'active' || Date.now() >= fresh.ends_at) throw new UserError('This giveaway is already closed.');
      const r = leave ? this.ctx.db.run('DELETE FROM giveaway_entries WHERE giveaway_id=? AND user_id=?', id, interaction.user.id) :
        this.ctx.db.run('INSERT OR IGNORE INTO giveaway_entries(giveaway_id,user_id,joined_at) VALUES(?,?,?)', id, interaction.user.id, Date.now());
      this.ctx.db.run('UPDATE giveaways SET dirty=1 WHERE id=?', id);
      return !!r.changes;
    });
    await interaction.editReply({ embeds: [goatEmbed(leave ? 'Entry Removed' : 'Entry Confirmed', colors.green)
      .setDescription(leave ? (changed ? 'You left the giveaway.' : 'You did not have an entry.') : (changed ? 'You are entered. Good luck, GOAT!' : 'You already have an entry. Your chance is unchanged.'))], allowedMentions: noMentions });
  }
  async end(id: string, moderatorId: string): Promise<void> {
    await this.mutex.run(id, async () => {
      const g = this.get(id);
      if (g.state !== 'active') throw new UserError('Only an active giveaway can be ended.');
      this.ctx.db.run("UPDATE giveaways SET state='ending',ended_by=?,retry_at=0 WHERE id=?", moderatorId, id);
      await this.finish(this.get(id));
    });
  }
  async cancel(id: string, moderatorId: string, reason: string): Promise<void> {
    await this.mutex.run(id, async () => {
      const g = this.get(id);
      if (g.state !== 'active' && g.state !== 'publishing') throw new UserError('Only an active or unpublished giveaway can be cancelled.');
      this.ctx.db.run("UPDATE giveaways SET state='cancelled',ended_by=?,cancel_reason=?,dirty=1,retry_at=0 WHERE id=?", moderatorId, reason, id);
      if (g.message_id) await this.update(this.get(id));
      this.ctx.logs.enqueue({ embeds: [goatEmbed('Giveaway Cancelled', colors.orange).setDescription(`**${g.title}**\n${clip(reason, 1200)}`)
        .addFields({ name: 'Cancelled By', value: `<@${moderatorId}>` }, { name: 'Giveaway ID', value: `\`${g.id}\`` }).toJSON()] }, `gw-cancel:${id}`);
    });
  }
  async reroll(id: string, moderatorId: string): Promise<void> {
    await this.mutex.run(id, async () => {
      const g = this.get(id);
      if (g.state !== 'ended') throw new UserError('Only an ended giveaway can be rerolled.');
      const unfinished = this.ctx.db.get<DrawRow>('SELECT * FROM giveaway_draws WHERE giveaway_id=? AND (complete=0 OR announced_id IS NULL) ORDER BY round DESC LIMIT 1', id);
      if (unfinished) throw new UserError('A draw is still being delivered. Try again when it finishes.');
      this.makeDraw(g);
      this.ctx.db.run('UPDATE giveaways SET ended_by=?,retry_at=0 WHERE id=?', moderatorId, id);
      await this.finish(this.get(id));
    });
  }
  private makeDraw(g: GiveawayRow): DrawRow {
    const previous = this.ctx.db.all<DrawRow>('SELECT * FROM giveaway_draws WHERE giveaway_id=? ORDER BY round', g.id);
    const excluded = new Set(previous.flatMap(d => JSON.parse(d.winners_json) as string[]));
    const participants = this.ctx.db.all<{ user_id: string }>('SELECT user_id FROM giveaway_entries WHERE giveaway_id=? ORDER BY user_id', g.id)
      .map(r => r.user_id).filter(id => !excluded.has(id));
    const round = (previous.at(-1)?.round ?? 0) + 1;
    this.ctx.db.run('INSERT INTO giveaway_draws(giveaway_id,round,candidate_order,drawn_at) VALUES(?,?,?,?)', g.id, round, JSON.stringify(shuffle(participants)), Date.now());
    return this.ctx.db.get<DrawRow>('SELECT * FROM giveaway_draws WHERE giveaway_id=? AND round=?', g.id, round)!;
  }
  private async finish(g: GiveawayRow): Promise<void> {
    let draw = this.ctx.db.get<DrawRow>('SELECT * FROM giveaway_draws WHERE giveaway_id=? ORDER BY round DESC LIMIT 1', g.id) ?? this.makeDraw(g);
    const order = JSON.parse(draw.candidate_order) as string[];
    const winners = JSON.parse(draw.winners_json) as string[];
    if (!draw.complete) {
      for (let i = draw.candidate_index; i < order.length && winners.length < g.winners; i++) {
        if (this.ctx.stopping) return;
        let eligible = false;
        try {
          const m = await this.ctx.guild.members.fetch({ user: order[i], force: true });
          eligible = !m.user.bot && (!g.role_id || m.roles.cache.has(g.role_id)) &&
            this.ctx.db.count(g.guild_id, m.id, periodStart(g.period, this.ctx.config.timezone)) >= g.min_messages;
        } catch (err) { if (errorCode(err) !== 10007 && errorCode(err) !== 10013) throw err; }
        if (eligible) winners.push(order[i]);
        this.ctx.db.run('UPDATE giveaway_draws SET candidate_index=?,winners_json=? WHERE giveaway_id=? AND round=?', i + 1, JSON.stringify(winners), g.id, draw.round);
      }
      this.ctx.db.transaction(() => {
        this.ctx.db.run('UPDATE giveaway_draws SET complete=1 WHERE giveaway_id=? AND round=?', g.id, draw.round);
        this.ctx.db.run("UPDATE giveaways SET state='ended',dirty=1,error=NULL WHERE id=?", g.id);
      });
      draw = this.ctx.db.get<DrawRow>('SELECT * FROM giveaway_draws WHERE giveaway_id=? AND round=?', g.id, draw.round)!;
    }
    await this.update(this.get(g.id));
    if (!draw.announced_id) {
      const channel = await this.validateChannel(g.channel_id);
      const footer = `GOAT • Giveaway ${g.id} • Draw ${draw.round}`;
      let announcement = await this.findMessage(channel, footer, draw.drawn_at);
      if (!announcement) announcement = await channel.send({ content: winners.length ? winners.map(id => `<@${id}>`).join(' ') : undefined,
        embeds: [goatEmbed(draw.round > 1 ? 'Giveaway Rerolled' : 'Giveaway Winners', winners.length ? colors.green : colors.orange)
          .setDescription(winners.length ? `**${g.title}**\n\nCongratulations ${winners.map(id => `<@${id}>`).join(', ')}!\nYou won **${g.prize}**.` : `**${g.title}**\nNo eligible entries were available. No winner was selected.`)
          .addFields({ name: 'Host', value: `<@${g.host_id}>` }, { name: 'Giveaway', value: `[Open giveaway](https://discord.com/channels/${g.guild_id}/${g.channel_id}/${g.message_id})` })
          .setFooter({ text: footer })], allowedMentions: { ...noMentions, users: winners }, nonce: `gw-${g.id}-${draw.round}`, enforceNonce: true });
      this.ctx.db.run('UPDATE giveaway_draws SET announced_id=? WHERE giveaway_id=? AND round=?', announcement.id, g.id, draw.round);
      this.ctx.logs.enqueue({ embeds: [goatEmbed(draw.round > 1 ? 'Giveaway Reroll Complete' : 'Giveaway Ended', colors.green)
        .setDescription(`**${g.title}**\nPrize: ${g.prize}`).addFields({ name: 'Winners', value: winners.map(id => `<@${id}> (\`${id}\`)`).join('\n') || 'No eligible entries' },
          { name: 'Entries', value: String(this.entries(g.id)), inline: true }, { name: 'Draw', value: String(draw.round), inline: true },
          { name: 'Ended By', value: g.ended_by ? `<@${g.ended_by}>` : 'GOAT automatic scheduler' }, { name: 'Giveaway ID', value: `\`${g.id}\`` }).toJSON()] }, `gw-draw:${g.id}:${draw.round}`);
    }
    if (!draw.dm_done) {
      for (const id of winners) {
        if (this.ctx.db.get('SELECT status FROM giveaway_dms WHERE giveaway_id=? AND round=? AND user_id=?', g.id, draw.round, id)) continue;
        try {
          const user = await this.ctx.client.users.fetch(id);
          await user.send({ embeds: [goatEmbed('You Won!', colors.green).setDescription(`You won **${g.prize}** in **${this.ctx.guild.name}**.`)
            .addFields({ name: 'Giveaway', value: g.title }, { name: 'Host', value: `<@${g.host_id}>` },
              { name: 'Details', value: `[Open giveaway](https://discord.com/channels/${g.guild_id}/${g.channel_id}/${g.message_id})` })],
            allowedMentions: noMentions, nonce: createHash('sha256').update(`${g.id}:${draw.round}:${id}`).digest('hex').slice(0, 24), enforceNonce: true });
          this.ctx.db.run("INSERT OR IGNORE INTO giveaway_dms VALUES(?,?,?,'sent')", g.id, draw.round, id);
        } catch (err) {
          if (errorCode(err) !== 50007) throw err;
          this.ctx.db.run("INSERT OR IGNORE INTO giveaway_dms VALUES(?,?,?,'blocked')", g.id, draw.round, id);
        }
      }
      this.ctx.db.run('UPDATE giveaway_draws SET dm_done=1 WHERE giveaway_id=? AND round=?', g.id, draw.round);
    }
    this.ctx.db.run('UPDATE giveaways SET retry_at=0,error=NULL WHERE id=?', g.id);
  }
  private async update(g: GiveawayRow): Promise<void> {
    if (!g.message_id) { this.ctx.db.run('UPDATE giveaways SET dirty=0 WHERE id=?', g.id); return; }
    const channel = await this.validateChannel(g.channel_id);
    try {
      const message = await channel.messages.fetch(g.message_id);
      await message.edit({ embeds: [this.render(g)], components: giveawayButtons(g.id, this.entries(g.id), g.state === 'active'), allowedMentions: noMentions });
    } catch (err) {
      if (errorCode(err) !== 10008) throw err;
      // Deleting an active giveaway cancels it; a finished draw remains recoverable.
      if (g.state === 'active') this.ctx.db.run("UPDATE giveaways SET state='cancelled',cancel_reason='The giveaway message was deleted.' WHERE id=?", g.id);
    }
    this.ctx.db.run('UPDATE giveaways SET dirty=0,last_update=? WHERE id=?', Date.now(), g.id);
  }
  async tick(): Promise<void> {
    if (this.busy || this.ctx.stopping) return;
    this.busy = true;
    try {
      const rows = this.ctx.db.all<GiveawayRow>(`SELECT * FROM giveaways WHERE guild_id=? AND retry_at<=? AND
        (state IN ('publishing','ending') OR (state='active' AND (ends_at<=? OR (dirty=1 AND last_update<=?))) OR
        (state IN ('ended','cancelled') AND dirty=1) OR EXISTS(SELECT 1 FROM giveaway_draws d WHERE d.giveaway_id=giveaways.id AND (d.complete=0 OR d.announced_id IS NULL OR d.dm_done=0)))
        ORDER BY ends_at LIMIT 20`, this.ctx.guild.id, Date.now(), Date.now(), Date.now() - 5000);
      for (const row of rows) {
        if (this.ctx.stopping) return;
        await this.mutex.run(row.id, async () => {
          try {
            let g = this.get(row.id);
            if (g.state === 'publishing') { await this.publish(g); g = this.get(g.id); }
            if (g.state === 'active' && g.ends_at <= Date.now()) {
              this.ctx.db.run("UPDATE giveaways SET state='ending' WHERE id=? AND state='active'", g.id); g = this.get(g.id);
            }
            const pendingDraw = this.ctx.db.get('SELECT 1 FROM giveaway_draws WHERE giveaway_id=? AND (complete=0 OR announced_id IS NULL OR dm_done=0)', g.id);
            if (g.state === 'ending' || pendingDraw) await this.finish(g);
            else if (g.dirty) await this.update(g);
          } catch (err) {
            this.ctx.db.run('UPDATE giveaways SET error=?,retry_at=? WHERE id=?', errorText(err), Date.now() + 30_000, row.id);
            this.ctx.logger.warn({ giveawayId: row.id, error: errorText(err) }, 'GOAT giveaway will resume without redrawing saved winners');
          }
        });
      }
    } catch (err) { this.ctx.logger.error({ error: errorText(err) }, 'GOAT giveaway worker failed'); }
    finally { this.busy = false; }
  }
}
