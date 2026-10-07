import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, ChannelType, LabelBuilder, MessageFlags,
  ModalBuilder, OverwriteType, PermissionFlagsBits, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type GuildTextBasedChannel, type ModalSubmitInteraction, type OverwriteData, type TextChannel
} from 'discord.js';
import type { Config } from '../core/config.js';
import type { Context } from '../core/types.js';
import { isStaff } from '../core/access.js';
import { colors, goatEmbed, noMentions } from '../core/embeds.js';
import { errorCode, errorText, humanDuration, Mutex, safeText, stamp, UserError } from '../core/util.js';
import { captureConversation } from './transcripts.js';
import { TicketVoteService } from './ticket-votes.js';
import { VERSION } from '../core/version.js';

export type TicketKind = 'application' | 'support';
export interface TicketRow {
  id: number; guild_id: string; owner_id: string; kind: TicketKind; channel_id: string | null;
  opening_message_id: string | null; state: string; claimed_by: string | null; created_at: number;
  closed_at: number | null; closed_by: string | null; close_reason: string | null; revision: number;
  transcript_key: string | null; retry_at: number; error: string | null;
  permissions_dirty: number; embed_dirty: number; roblox_username: string | null; owner_name: string | null;
}
export function ticketOverwrites(config: Config, guildId: string, botId: string, ownerId?: string, participants: string[] = [], open = true): OverwriteData[] {
  const read = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory;
  const write = PermissionFlagsBits.SendMessages | PermissionFlagsBits.AttachFiles | PermissionFlagsBits.EmbedLinks | PermissionFlagsBits.AddReactions;
  const rows = new Map<string, OverwriteData>();
  rows.set(guildId, { id: guildId, type: OverwriteType.Role, deny: PermissionFlagsBits.ViewChannel });
  for (const roleId of config.access.staffRoleIds) rows.set(roleId, { id: roleId, type: OverwriteType.Role, allow: read | (open ? write : 0n), deny: open ? 0n : write });
  for (const userId of [...config.access.ownerUserIds, ...(ownerId ? [ownerId] : []), ...participants]) {
    rows.set(userId, { id: userId, type: OverwriteType.Member, allow: read | (open ? write : 0n), deny: open ? 0n : write });
  }
  rows.set(botId, { id: botId, type: OverwriteType.Member, allow: read | write | PermissionFlagsBits.ManageChannels | PermissionFlagsBits.ManageMessages });
  return [...rows.values()];
}
export function ticketPanel() {
  return { embeds: [goatEmbed('Clan Hub', colors.cyan).setDescription('Your next chapter starts with **GOAT**.')
    .setThumbnail('attachment://goat-banner.png')
    .addFields({ name: '📋  Clan Application', value: 'Apply to the clan. Share your Roblox username and four screenshots.' },
      { name: '🎫  Support', value: 'Questions or a problem? Open a private conversation.' })
    .setFooter({ text: 'GOAT • One open ticket per member' }).setTimestamp(null)],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('goat:ticket:open:application').setLabel('Clan Application').setEmoji('📋').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('goat:ticket:open:support').setLabel('Support').setEmoji('🎫').setStyle(ButtonStyle.Primary))] };
}
export function applicationRequirements() {
  return goatEmbed('Clan Application', colors.cyan).setDescription(
    'Upload **four screenshots**. Your Roblox **@username** must be visible.\n\n' +
    '**1 · Mastery** — show your mastery and username, as in the example.\n' +
    '**2 · Gamepasses** — show your owned gamepasses.\n' +
    '**3 · Inventory** — show your inventory.\n' +
    '**4 · Stats** — show your in-game stats.')
    .setImage('attachment://application-mastery-example.png').setFooter({ text: 'GOAT • Keep the conversation in this ticket' }).setTimestamp(null);
}
export function normalizeRobloxUsername(input: string): string {
  const name = input.trim().replace(/^@/, '');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_]{1,18}[a-zA-Z0-9]$/.test(name) || (name.match(/_/g)?.length ?? 0) > 1) {
    throw new UserError('Enter your Roblox @username, not your display name. Use 3–20 letters/numbers and at most one underscore, inside the name.');
  }
  return name;
}
function controls(ticket: TicketRow) {
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (ticket.state === 'closed') row.addComponents(
    new ButtonBuilder().setCustomId(`goat:ticket:reopen:${ticket.id}`).setLabel('Reopen').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`goat:ticket:delete:${ticket.id}`).setLabel('Delete').setStyle(ButtonStyle.Danger));
  else row.addComponents(
    new ButtonBuilder().setCustomId(`goat:ticket:claim:${ticket.id}`).setLabel(ticket.claimed_by ? 'Claimed' : 'Claim')
      .setStyle(ButtonStyle.Secondary).setDisabled(!!ticket.claimed_by),
    new ButtonBuilder().setCustomId(`goat:ticket:close:${ticket.id}`).setLabel('Close').setStyle(ButtonStyle.Danger));
  const rows = [row];
  if (ticket.kind === 'application' && ticket.state !== 'closed') rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`goat:ticket:approve:${ticket.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`goat:ticket:reject:${ticket.id}`).setLabel('Reject').setStyle(ButtonStyle.Secondary)));
  return rows;
}
const kindName = (kind: TicketKind) => kind === 'application' ? 'Clan Application' : 'Support';

export class TicketService {
  private readonly mutex = new Mutex();
  private timer?: NodeJS.Timeout;
  private busy = false;
  private panelReady = false;
  private panelRetryAt = Date.now() + 5000;
  readonly votes: TicketVoteService;
  constructor(private readonly ctx: Context) {
    this.votes = new TicketVoteService(ctx);
    ctx.db.run("UPDATE ticket_reviews SET dirty=1,last_update=0 WHERE ticket_id IN (SELECT id FROM tickets WHERE guild_id=?) AND state IN ('voting','review','deciding')", ctx.guild.id);
  }
  start(): void { if (this.ctx.config.tickets.enabled) this.timer = setInterval(() => { void this.tick(); }, 2000); }
  stop(): void { if (this.timer) clearInterval(this.timer); }
  get(id: number): TicketRow {
    const ticket = this.ctx.db.get<TicketRow>('SELECT * FROM tickets WHERE id=? AND guild_id=?', id, this.ctx.guild.id);
    if (!ticket) throw new UserError('Ticket not found.');
    return ticket;
  }
  fromChannel(channelId: string): TicketRow | undefined {
    return this.ctx.db.get<TicketRow>('SELECT * FROM tickets WHERE guild_id=? AND channel_id=?', this.ctx.guild.id, channelId);
  }
  private enabled(): void { if (!this.ctx.config.tickets.enabled) throw new UserError('Tickets are currently unavailable.'); }
  private async sendable(id: string): Promise<GuildTextBasedChannel> {
    const channel = await this.ctx.guild.channels.fetch(id);
    if (!channel?.isTextBased() || !('send' in channel)) throw new UserError('The configured ticket channel is unavailable.');
    return channel;
  }
  async ensurePanel(force = false): Promise<void> {
    await this.mutex.run('panel', async () => {
      try { await this.syncPanel(force); this.panelReady = true; }
      catch (err) { this.panelReady = false; this.panelRetryAt = Date.now() + 30000; throw err; }
    });
  }
  private async syncPanel(force: boolean): Promise<void> {
    this.enabled();
    await this.sendable(this.ctx.config.tickets.logChannelId);
    const channel = await this.sendable(this.ctx.config.tickets.panelChannelId);
    let message;
    const savedChannel = this.ctx.db.meta('ticket_panel_channel_id');
    const savedId = this.ctx.db.meta('ticket_panel_message_id');
    if (savedChannel === channel.id && savedId) {
      try { message = await channel.messages.fetch(savedId); }
      catch (err) { if (errorCode(err) !== 10008) throw err; }
    }
    if (!message) {
      const recent = await channel.messages.fetch({ limit: 100 });
      message = [...recent.values()].find(m => m.author.id === this.ctx.client.user?.id && m.components.some(row =>
        'components' in row && row.components.some(component => 'customId' in component && component.customId === 'goat:ticket:open:application')));
    }
    const panel = { ...ticketPanel(), files: [new AttachmentBuilder(resolve('assets/goat-banner.png'))], allowedMentions: noMentions };
    if (!message) message = await channel.send({ ...panel, nonce: `goat-panel-${channel.id.slice(-10)}`, enforceNonce: true });
    else if (force || this.ctx.db.meta('ticket_panel_version') !== VERSION) await message.edit({ ...panel, attachments: [] });
    this.ctx.db.setMeta('ticket_panel_channel_id', channel.id);
    this.ctx.db.setMeta('ticket_panel_message_id', message.id);
    this.ctx.db.setMeta('ticket_panel_version', VERSION);
  }
  private async category(): Promise<string> {
    return this.mutex.run('category', async () => {
      const saved = this.ctx.config.tickets.categoryId ?? this.ctx.db.meta('ticket_category_id');
      if (saved) {
        const existing = await this.ctx.guild.channels.fetch(saved).catch(err => {
          if (errorCode(err) !== 10003) throw err;
          return null;
        });
        if (existing?.type === ChannelType.GuildCategory) return existing.id;
        if (this.ctx.config.tickets.categoryId) throw new UserError('The configured ticket category is unavailable.');
      }
      const channels = await this.ctx.guild.channels.fetch();
      let category = [...channels.values()].find(c => c?.type === ChannelType.GuildCategory && c.name === 'GOAT Tickets');
      category ??= await this.ctx.guild.channels.create({ name: 'GOAT Tickets', type: ChannelType.GuildCategory,
        permissionOverwrites: ticketOverwrites(this.ctx.config, this.ctx.guild.id, this.ctx.client.user!.id), reason: 'GOAT • Tickets category' });
      this.ctx.db.setMeta('ticket_category_id', category.id);
      return category.id;
    });
  }
  private participants(id: number): string[] {
    return this.ctx.db.all<{ user_id: string }>('SELECT user_id FROM ticket_participants WHERE ticket_id=?', id).map(row => row.user_id);
  }
  private async channel(ticket: TicketRow): Promise<TextChannel> {
    if (!ticket.channel_id) throw new UserError('This ticket is still being created.');
    const channel = await this.ctx.guild.channels.fetch(ticket.channel_id);
    if (channel?.type !== ChannelType.GuildText) throw new UserError('The ticket channel is unavailable.');
    return channel;
  }
  private async permissions(ticket: TicketRow, open: boolean): Promise<void> {
    const channel = await this.channel(ticket);
    await channel.permissionOverwrites.set(ticketOverwrites(this.ctx.config, this.ctx.guild.id, this.ctx.client.user!.id,
      ticket.owner_id, this.participants(ticket.id), open), `GOAT • Ticket #${ticket.id} permissions`);
    this.ctx.db.run('UPDATE tickets SET permissions_dirty=0 WHERE id=?', ticket.id);
  }
  private active(ownerId: string): TicketRow | undefined {
    return this.ctx.db.get<TicketRow>("SELECT * FROM tickets WHERE guild_id=? AND owner_id=? AND state IN ('creating','open','closing','reopening') ORDER BY id LIMIT 1", this.ctx.guild.id, ownerId);
  }
  private quota(ownerId: string, now: number): void {
    const config = this.ctx.config.tickets;
    const last = this.ctx.db.get<{ created_at: number }>('SELECT created_at FROM tickets WHERE guild_id=? AND owner_id=? ORDER BY created_at DESC LIMIT 1', this.ctx.guild.id, ownerId);
    if (last && now - last.created_at < config.cooldownSeconds * 1000) throw new UserError(`Wait ${humanDuration(last.created_at + config.cooldownSeconds * 1000 - now)} before opening another ticket.`);
    const recent = this.ctx.db.get<{ n: number }>('SELECT COUNT(*) n FROM tickets WHERE guild_id=? AND owner_id=? AND created_at>?', this.ctx.guild.id, ownerId, now - 3600000)!.n;
    if (recent >= config.maxTicketsPerHour) throw new UserError('You have reached the hourly ticket limit. Please try again later.');
    const total = this.ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM tickets WHERE guild_id=? AND state IN ('creating','open','closing','reopening')", this.ctx.guild.id)!.n;
    if (total >= config.maxOpenTickets) throw new UserError('The ticket queue is full. Please try again later.');
  }
  async open(interaction: ButtonInteraction, kind: string): Promise<void> {
    this.enabled();
    if (kind !== 'application' && kind !== 'support') throw new UserError('Choose a valid ticket option.');
    if (interaction.channelId !== this.ctx.config.tickets.panelChannelId || interaction.message.id !== this.ctx.db.meta('ticket_panel_message_id')) throw new UserError('Use the current GOAT ticket panel.');
    const active = this.active(interaction.user.id);
    if (active) { await interaction.reply({ content: active.channel_id ? `Your existing ticket: <#${active.channel_id}>` : 'Your ticket is being prepared.', flags: MessageFlags.Ephemeral, allowedMentions: noMentions }); return; }
    this.quota(interaction.user.id, Date.now());
    const recent = this.ctx.db.get<{ expires_at: number }>('SELECT expires_at FROM ticket_requests WHERE guild_id=? AND user_id=? ORDER BY expires_at DESC LIMIT 1', this.ctx.guild.id, interaction.user.id);
    if (recent && recent.expires_at - 900000 > Date.now() - 3000) throw new UserError('Please wait a few seconds before opening the form again.');
    const id = randomUUID();
    this.ctx.db.run('INSERT INTO ticket_requests(id,guild_id,user_id,kind,panel_message_id,expires_at) VALUES(?,?,?,?,?,?)', id,
      this.ctx.guild.id, interaction.user.id, kind, interaction.message.id, Date.now() + 900000);
    await interaction.showModal(new ModalBuilder().setCustomId(`goat:ticket:open-modal:${id}`).setTitle(`GOAT • ${kindName(kind)}`).addLabelComponents(
      new LabelBuilder().setLabel('Roblox username').setDescription('The username after @ on your Roblox profile, not your display name.')
        .setTextInputComponent(new TextInputBuilder().setCustomId('roblox-username').setStyle(TextInputStyle.Short)
          .setRequired(true).setMinLength(3).setMaxLength(21).setPlaceholder('@YourRobloxUsername'))));
  }
  async openModal(interaction: ModalSubmitInteraction, requestId: string): Promise<void> {
    this.enabled();
    const request = this.ctx.db.get<{ id: string; user_id: string; kind: TicketKind; expires_at: number; panel_message_id: string; ticket_id: number | null }>('SELECT * FROM ticket_requests WHERE id=? AND guild_id=?', requestId, this.ctx.guild.id);
    if (!request || request.user_id !== interaction.user.id || request.expires_at < Date.now() || interaction.channelId !== this.ctx.config.tickets.panelChannelId || request.panel_message_id !== this.ctx.db.meta('ticket_panel_message_id')) throw new UserError('This form has expired. Open the current GOAT ticket panel again.');
    const username = normalizeRobloxUsername(interaction.fields.getTextInputValue('roblox-username'));
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const member = await this.ctx.guild.members.fetch({ user: interaction.user.id, force: true });
    if (member.user.bot) throw new UserError('Bots cannot open tickets.');
    await this.mutex.run(`open:${member.id}`, async () => {
      let ticket = request.ticket_id ? this.get(request.ticket_id) : this.active(member.id);
      if (ticket && !['creating','open','closing','reopening'].includes(ticket.state)) throw new UserError('This form has already been used. Open a new form from the ticket panel.');
      if (!ticket) {
        this.ctx.db.transaction(() => {
          this.quota(member.id, Date.now());
          const id = Number(this.ctx.db.run('INSERT INTO tickets(guild_id,owner_id,kind,created_at,roblox_username,owner_name) VALUES(?,?,?,?,?,?)', this.ctx.guild.id, member.id, request.kind, Date.now(), username, member.displayName).lastInsertRowid);
          this.ctx.db.run('UPDATE ticket_requests SET ticket_id=? WHERE id=?', id, requestId); ticket = this.get(id);
        });
      }
      if (ticket!.state === 'creating') await this.mutex.run(`ticket:${ticket!.id}`, () => this.finishCreate(ticket!));
      const ready = this.get(ticket!.id);
      await interaction.editReply({ content: ready.channel_id ? `Your ticket: <#${ready.channel_id}>` : 'Your ticket is being prepared.', allowedMentions: noMentions });
    });
  }
  private async finishCreate(ticket: TicketRow): Promise<void> {
    await this.ctx.guild.members.fetch({ user: ticket.owner_id, force: true });
    let channel = ticket.channel_id ? await this.channel(ticket) : undefined;
    const topic = `GOAT ticket #${ticket.id} | ${ticket.kind} | ${ticket.owner_id}`;
    if (!channel) {
      const channels = await this.ctx.guild.channels.fetch();
      channel = [...channels.values()].find(c => c?.type === ChannelType.GuildText && c.topic === topic) as TextChannel | undefined;
      channel ??= await this.ctx.guild.channels.create({ name: `${ticket.kind === 'application' ? 'clan' : 'support'}-${String(ticket.id).padStart(4, '0')}`,
        type: ChannelType.GuildText, parent: await this.category(), topic,
        permissionOverwrites: ticketOverwrites(this.ctx.config, this.ctx.guild.id, this.ctx.client.user!.id, ticket.owner_id), reason: `GOAT • Ticket #${ticket.id} opened` });
      this.ctx.db.run('UPDATE tickets SET channel_id=? WHERE id=?', channel.id, ticket.id);
    }
    ticket = this.get(ticket.id);
    await this.permissions(ticket, true);
    let opening;
    if (ticket.opening_message_id) {
      try { opening = await channel.messages.fetch(ticket.opening_message_id); }
      catch (err) { if (errorCode(err) !== 10008) throw err; }
    }
    if (!opening) {
      const recent = await channel.messages.fetch({ limit: 100 });
      opening = [...recent.values()].find(m => m.author.id === this.ctx.client.user?.id && m.components.some(row => 'components' in row &&
        row.components.some(c => 'customId' in c && c.customId === `goat:ticket:close:${ticket.id}`)));
    }
    if (!opening) opening = await channel.send({ ...this.introduction(ticket), content: `<@${ticket.owner_id}>`,
      allowedMentions: { ...noMentions, users: [ticket.owner_id] }, nonce: `goat-ticket-${ticket.id}`, enforceNonce: true });
    this.ctx.db.transaction(() => {
      this.ctx.db.run("UPDATE tickets SET state='open',opening_message_id=?,error=NULL,retry_at=0 WHERE id=?", opening!.id, ticket.id);
      this.log(ticket, 'Ticket Opened', ticket.owner_id, `**${kindName(ticket.kind)}** • Roblox \`@${ticket.roblox_username ?? 'Not supplied'}\`\nOpened ${stamp(ticket.created_at)}`, `ticket-open:${ticket.id}`);
    });
    this.votes.queue(this.get(ticket.id));
  }
  private log(ticket: TicketRow, title: string, actorId: string, details: string, key: string): void {
    const embed = goatEmbed(title, colors.cyan).setDescription(details).addFields(
      { name: 'Ticket', value: `#${ticket.id}${ticket.channel_id ? ` • <#${ticket.channel_id}>` : ''}`, inline: true },
      { name: 'Member', value: `<@${ticket.owner_id}> • \`${ticket.owner_id}\``, inline: true });
    if (actorId !== ticket.owner_id) embed.addFields({ name: 'Performed By', value: `<@${actorId}> • \`${actorId}\`` });
    this.ctx.logs.enqueue({ channelId: this.ctx.config.tickets.logChannelId, embeds: [embed.toJSON()] }, key);
  }
  private async access(interaction: ButtonInteraction | ModalSubmitInteraction, ticket: TicketRow, staffOnly = false): Promise<void> {
    if (interaction.channelId !== ticket.channel_id) throw new UserError('Use the controls inside this ticket.');
    if (!await isStaff(interaction, this.ctx.config) && (staffOnly || interaction.user.id !== ticket.owner_id)) throw new UserError('This action is restricted.');
  }
  private introduction(ticket: TicketRow) {
    const review = this.votes.get(ticket.id);
    const closed = ticket.state === 'closed';
    const label = closed ? (review?.decision === 'accepted' ? 'Application Accepted' : review?.decision === 'rejected' ? 'Application Rejected' : 'Ticket Closed') : kindName(ticket.kind);
    const embed = closed ? goatEmbed(label, review?.decision === 'accepted' ? colors.green : review?.decision === 'rejected' ? colors.red : colors.orange)
      .setDescription(safeText(ticket.close_reason ?? 'This conversation has ended.', 1000)) :
      ticket.kind === 'application' ? applicationRequirements() : goatEmbed('Support', colors.cyan)
        .setDescription('Describe what you need help with. Add screenshots if they help explain the problem.').setThumbnail('attachment://goat-banner.png');
    embed.setTitle(`GOAT • ${label} #${String(ticket.id).padStart(4, '0')}`).setTimestamp(null)
      .setFooter({ text: closed ? 'GOAT • Conversation saved' : 'GOAT • Keep the conversation in this ticket' })
      .addFields({ name: 'Roblox username', value: `\`@${ticket.roblox_username ?? 'Not supplied before update'}\`` });
    return { embeds: [embed], components: controls(ticket), files: closed ? [] : [new AttachmentBuilder(resolve(
      ticket.kind === 'application' ? 'assets/application-mastery-example.png' : 'assets/goat-banner.png'))], allowedMentions: noMentions };
  }
  private async refreshControls(ticket: TicketRow): Promise<void> {
    if (!ticket.opening_message_id) return;
    const channel = await this.channel(ticket);
    try { const message = await channel.messages.fetch(ticket.opening_message_id); await message.edit({ ...this.introduction(ticket), attachments: [] }); }
    catch (err) {
      if (errorCode(err) !== 10008) throw err;
      const replacement = await channel.send({ ...this.introduction(ticket), nonce: `controls-${ticket.id}-${ticket.revision}`, enforceNonce: true });
      this.ctx.db.run('UPDATE tickets SET opening_message_id=? WHERE id=?', replacement.id, ticket.id);
    }
  }
  async button(interaction: ButtonInteraction, action: string, id: string): Promise<void> {
    this.enabled();
    if (action === 'open') { await this.open(interaction, id); return; }
    if (!/^\d+$/.test(id)) throw new UserError('Ticket not found.');
    const ticket = this.get(Number(id));
    if (action === 'vote-yes' || action === 'vote-no') { await this.votes.vote(interaction, ticket.id, action === 'vote-yes' ? 'yes' : 'no'); return; }
    if (action === 'approve' || action === 'reject') { await this.votes.decisionModal(interaction, ticket.id, action === 'approve' ? 'accepted' : 'rejected'); return; }
    await this.access(interaction, ticket, action === 'claim' || action === 'delete' || action === 'delete-confirm' || (action === 'reopen' && !!this.votes.get(ticket.id)?.decision));
    if (action === 'close') {
      if (ticket.state !== 'open') throw new UserError('This ticket is already closed or is being updated.');
      await interaction.showModal(new ModalBuilder().setCustomId(`goat:ticket:close-modal:${ticket.id}`).setTitle('GOAT • Close Ticket').addLabelComponents(
        new LabelBuilder().setLabel('Reason').setTextInputComponent(new TextInputBuilder().setCustomId('reason').setStyle(TextInputStyle.Paragraph)
          .setRequired(true).setMaxLength(1000).setPlaceholder('Why is this ticket being closed?')))); return;
    }
    if (action === 'delete') {
      if (ticket.state !== 'closed') throw new UserError('Close the ticket and save its transcript before deleting it.');
      await interaction.reply({ content: 'Delete this closed ticket channel?', flags: MessageFlags.Ephemeral, allowedMentions: noMentions,
        components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`goat:ticket:delete-confirm:${ticket.id}`)
          .setLabel('Delete Ticket').setStyle(ButtonStyle.Danger))] }); return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await this.mutex.run(`ticket:${ticket.id}`, async () => {
      const fresh = this.get(ticket.id);
      if (action === 'claim') {
        if (fresh.state !== 'open') throw new UserError('Only an open ticket can be claimed.');
        if (fresh.claimed_by && fresh.claimed_by !== interaction.user.id) throw new UserError('This ticket has already been claimed.');
        this.ctx.db.run('UPDATE tickets SET claimed_by=? WHERE id=?', interaction.user.id, ticket.id);
        await this.refreshControls(this.get(ticket.id));
        this.log(fresh, 'Ticket Claimed', interaction.user.id, `Assigned to <@${interaction.user.id}>.`, `ticket-claim:${ticket.id}:${fresh.revision}`);
        await interaction.editReply({ content: 'Ticket claimed.', allowedMentions: noMentions }); return;
      }
      if (action === 'reopen') {
        if (fresh.state !== 'closed') throw new UserError('Only a closed ticket can be reopened.');
        if (this.ctx.db.get("SELECT 1 FROM tickets WHERE guild_id=? AND owner_id=? AND state IN ('creating','open','closing','reopening') AND id<>?", this.ctx.guild.id, fresh.owner_id, fresh.id)) throw new UserError('There is already another active ticket for this member.');
        this.ctx.db.run("UPDATE tickets SET state='reopening',retry_at=0 WHERE id=?", fresh.id);
        await this.finishReopen(this.get(fresh.id));
        this.log(fresh, 'Ticket Reopened', interaction.user.id, 'The conversation is open again.', `ticket-reopen:${fresh.id}:${fresh.revision}`);
        await interaction.editReply({ content: 'Ticket reopened.', allowedMentions: noMentions }); return;
      }
      if (action === 'delete-confirm') {
        await this.access(interaction, fresh, true);
        if (fresh.state !== 'closed') throw new UserError('Only a closed ticket can be deleted.');
        const keys = fresh.transcript_key ? JSON.parse(fresh.transcript_key) as string[] : [];
        if (!keys.length || !keys.every(key => this.ctx.logs.delivered(key))) throw new UserError('The transcript is still being delivered to Ticket Logs. Try again once delivery completes.');
        await interaction.editReply({ content: 'Transcript saved. Deleting the ticket.', allowedMentions: noMentions });
        await (await this.channel(fresh)).delete(`GOAT • Ticket #${fresh.id} deleted by ${interaction.user.id}`);
        this.ctx.db.run("UPDATE tickets SET state='deleted' WHERE id=?", fresh.id);
        this.log(fresh, 'Ticket Deleted', interaction.user.id, 'The closed channel was removed. Its transcript remains in Ticket Logs.', `ticket-delete:${fresh.id}`); return;
      }
      throw new UserError('This ticket button is unavailable.');
    });
  }
  async closeModal(interaction: ModalSubmitInteraction, id: string): Promise<void> {
    this.enabled();
    if (!/^\d+$/.test(id)) throw new UserError('Ticket not found.');
    const ticket = this.get(Number(id));
    await this.access(interaction, ticket);
    const reason = interaction.fields.getTextInputValue('reason').trim();
    if (!reason) throw new UserError('Enter a closing reason.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await this.close(ticket.id, interaction.user.id, reason);
    await interaction.editReply({ content: 'Ticket closed. The transcript is queued for Ticket Logs.', allowedMentions: noMentions });
  }
  async close(id: number, actorId: string, reason: string, decisionClose = false): Promise<void> {
    await this.mutex.run(`ticket:${id}`, async () => {
      const ticket = this.get(id);
      if (ticket.state !== 'open') throw new UserError('This ticket is already closed or is being updated.');
      if (this.votes.get(id)?.decision && this.votes.get(id)?.state === 'deciding' && !decisionClose) throw new UserError('The application decision is being finalized.');
      this.votes.cancel(id);
      this.ctx.db.run("UPDATE tickets SET state='closing',closed_at=?,closed_by=?,close_reason=?,revision=revision+1,transcript_key=NULL,retry_at=0 WHERE id=?", Date.now(), actorId, reason, id);
      await this.finishClose(this.get(id));
    });
  }
  private async finishClose(ticket: TicketRow): Promise<void> {
    await this.permissions(ticket, false);
    const channel = await this.channel(ticket);
    if (!ticket.transcript_key) {
      const review = this.votes.get(ticket.id);
      const metadata = `Type: ${kindName(ticket.kind)}\nRoblox username: @${ticket.roblox_username ?? 'Not supplied'}\nOwner: ${ticket.owner_name ?? ticket.owner_id} (${ticket.owner_id})\nChannel ID: ${ticket.channel_id}\nOpened: ${new Date(ticket.created_at).toISOString()}\nClosed: ${new Date(ticket.closed_at!).toISOString()}\nClosed by: ${ticket.closed_by}\nReason: ${ticket.close_reason}`;
      const conversation = await captureConversation(this.ctx, channel, ticket.id, metadata);
      const keys: string[] = [];
      this.ctx.db.transaction(() => {
        for (let offset = 0; offset < conversation.files.length; offset += 4) {
          const key = `ticket-transcript:${ticket.id}:${ticket.revision}:${offset / 4}`; keys.push(key);
          const embed = goatEmbed(offset === 0 ? (review?.decision === 'accepted' ? 'Application Accepted' : review?.decision === 'rejected' ? 'Application Rejected' : 'Ticket Closed') : 'Conversation Archive',
            review?.decision === 'accepted' ? colors.green : review?.decision === 'rejected' ? colors.red : colors.orange)
            .setDescription(offset === 0 ? `${safeText(ticket.close_reason ?? 'Closed', 900)}\n\n**Conversation**\n${conversation.summary}` : 'Additional conversation text.')
            .addFields({ name: 'Ticket', value: `#${ticket.id} • ${kindName(ticket.kind)}`, inline: true },
              { name: 'Applicant', value: `<@${ticket.owner_id}> • \`@${ticket.roblox_username ?? 'Not supplied'}\`\nID: \`${ticket.owner_id}\`` },
              { name: 'Closed By', value: `<@${ticket.closed_by}>`, inline: true },
              { name: 'Messages', value: `${conversation.messageCount} • ${conversation.participantCount} participants`, inline: true },
              { name: 'Opened', value: stamp(ticket.created_at, 'f'), inline: true }, { name: 'Closed', value: stamp(ticket.closed_at!, 'f'), inline: true });
          if (review?.decision) embed.addFields({ name: 'Vote', value: `${review.yes_count} Yes / ${review.no_count} No`, inline: true });
          this.ctx.logs.enqueue({ channelId: this.ctx.config.tickets.logChannelId, embeds: [embed.toJSON()], files: conversation.files.slice(offset, offset + 4) }, key);
        }
        this.ctx.db.run('UPDATE tickets SET transcript_key=? WHERE id=?', JSON.stringify(keys), ticket.id);
      });
    }
    await channel.setName(`closed-${String(ticket.id).padStart(4, '0')}`, `GOAT • Ticket #${ticket.id} closed`);
    await this.refreshControls({ ...this.get(ticket.id), state: 'closed' });
    this.ctx.db.run("UPDATE tickets SET state='closed',error=NULL,retry_at=0 WHERE id=?", ticket.id);
  }
  private async finishReopen(ticket: TicketRow): Promise<void> {
    await this.permissions(ticket, true);
    const channel = await this.channel(ticket);
    await channel.setName(`${ticket.kind === 'application' ? 'clan' : 'support'}-${String(ticket.id).padStart(4, '0')}`, `GOAT • Ticket #${ticket.id} reopened`);
    await this.refreshControls({ ...this.get(ticket.id), state: 'open', claimed_by: null });
    this.ctx.db.run("UPDATE tickets SET state='open',claimed_by=NULL,error=NULL,retry_at=0 WHERE id=?", ticket.id);
  }
  async participant(channelId: string, userId: string, actorId: string, remove: boolean): Promise<void> {
    const ticket = this.fromChannel(channelId);
    if (!ticket || ticket.state !== 'open') throw new UserError('Use this command inside an open ticket.');
    if (userId === ticket.owner_id || this.ctx.config.access.ownerUserIds.includes(userId) || userId === this.ctx.client.user?.id) throw new UserError('The ticket owner and GOAT service access cannot be changed here.');
    await this.mutex.run(`ticket:${ticket.id}`, async () => {
      if (this.get(ticket.id).state !== 'open') throw new UserError('This ticket is being updated.');
      if (!remove) {
        await this.ctx.guild.members.fetch({ user: userId, force: true });
        if (this.participants(ticket.id).length >= this.ctx.config.tickets.maxParticipants && !this.participants(ticket.id).includes(userId)) throw new UserError('This ticket has reached its participant limit.');
        this.ctx.db.run('INSERT OR IGNORE INTO ticket_participants VALUES(?,?,?)', ticket.id, userId, actorId);
      } else this.ctx.db.run('DELETE FROM ticket_participants WHERE ticket_id=? AND user_id=?', ticket.id, userId);
      this.ctx.db.run('UPDATE tickets SET permissions_dirty=1,retry_at=0 WHERE id=?', ticket.id);
      await this.permissions(this.get(ticket.id), true);
      this.log(ticket, remove ? 'Ticket Member Removed' : 'Ticket Member Added', actorId, `<@${userId}> • \`${userId}\``, `ticket-member:${ticket.id}:${userId}:${remove}:${Date.now()}`);
    });
  }
  channelDeleted(channelId: string): void {
    const ticket = this.fromChannel(channelId);
    if (!ticket || ticket.state === 'deleted') return;
    this.votes.cancel(ticket.id);
    this.ctx.db.run("UPDATE tickets SET state='deleted' WHERE id=?", ticket.id);
  }
  async syncPermissions(): Promise<void> {
    this.ctx.db.run("UPDATE tickets SET permissions_dirty=1,retry_at=0 WHERE guild_id=? AND state IN ('open','closed')", this.ctx.guild.id);
    if (this.ctx.db.meta('ticket_embed_version') !== VERSION) {
      this.ctx.db.run("UPDATE tickets SET embed_dirty=1,retry_at=0 WHERE guild_id=? AND state IN ('open','closed')", this.ctx.guild.id);
      this.ctx.db.setMeta('ticket_embed_version', VERSION);
    }
    await this.tick();
  }
  async tick(): Promise<void> {
    if (this.busy || this.ctx.stopping || !this.ctx.config.tickets.enabled) return;
    this.busy = true;
    try {
      if (!this.panelReady && Date.now() >= this.panelRetryAt) {
        try { await this.ensurePanel(); }
        catch (err) { this.ctx.logger.warn({ error: errorText(err) }, 'GOAT ticket panel will retry'); }
      }
      const pending = this.ctx.db.all<TicketRow>("SELECT * FROM tickets WHERE guild_id=? AND (state IN ('creating','closing','reopening') OR (state IN ('open','closed') AND (permissions_dirty=1 OR embed_dirty=1))) AND retry_at<=? ORDER BY id LIMIT 5", this.ctx.guild.id, Date.now());
      for (const ticket of pending) await this.mutex.run(`ticket:${ticket.id}`, async () => {
        try {
          const fresh = this.get(ticket.id);
          if (fresh.state === 'creating') await this.finishCreate(fresh);
          else if (fresh.state === 'closing') await this.finishClose(fresh);
          else if (fresh.state === 'reopening') await this.finishReopen(fresh);
          else {
            if (fresh.permissions_dirty) await this.permissions(fresh, fresh.state === 'open');
            if (fresh.embed_dirty) { await this.refreshControls(fresh); this.ctx.db.run('UPDATE tickets SET embed_dirty=0 WHERE id=?', fresh.id); }
          }
        } catch (err) {
          if (errorCode(err) === 10003 && ticket.channel_id) this.channelDeleted(ticket.channel_id);
          else if (errorCode(err) === 10007 && ticket.state === 'creating') this.ctx.db.run("UPDATE tickets SET state='cancelled',error=? WHERE id=?", errorText(err), ticket.id);
          else this.ctx.db.run('UPDATE tickets SET retry_at=?,error=? WHERE id=?', Date.now() + 30000, errorText(err), ticket.id);
          this.ctx.logger.warn({ ticketId: ticket.id, error: errorText(err) }, 'GOAT ticket operation will retry');
        }
      });
      await this.votes.tick();
    } catch (err) { this.ctx.logger.error({ error: errorText(err) }, 'GOAT ticket worker failed'); }
    finally { this.busy = false; }
  }
}
