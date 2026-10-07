import { AttachmentBuilder, MessageFlags, type Interaction, type ChatInputCommandInteraction } from 'discord.js';
import type { Context } from '../core/types.js';
import { isStaff, requireStaff } from '../core/access.js';
import { colors, goatEmbed, noMentions } from '../core/embeds.js';
import { clip, errorCode, errorText, humanDuration, periodStart, stamp, UserError, type Period } from '../core/util.js';
import { publicCommands } from './definitions.js';
import { renderWelcome } from '../services/welcome.js';
import type { GiveawayRow } from '../services/giveaways.js';
import type { CaseRow } from '../services/moderation.js';
import type { TicketRow } from '../services/tickets.js';

function coverage(ctx: Context): string {
  const s = ctx.history.summary();
  const state = ctx.db.meta('history_state') ?? 'not started';
  return `${s.indexed.toLocaleString('en-US')} messages indexed • ${ctx.history.running ? 'import in progress' : state}${s.errors ? ` • ${s.errors} channels with errors` : ''}\nOnly available, accessible history can be counted. Deleted messages already observed by GOAT remain in the totals.`;
}
async function command(ctx: Context, i: ChatInputCommandInteraction): Promise<void> {
  const name = i.commandName;
  if (!publicCommands.has(name)) await requireStaff(i, ctx.config);
  if (name === 'giveway-create' || name === 'giveaway-create') { await ctx.giveaways.create(i); return; }
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const reply = async (title: string, description: string) => { await i.editReply({ embeds: [goatEmbed(title).setDescription(description)], allowedMentions: noMentions }); };
  switch (name) {
    case 'messages': {
      const user = i.options.getUser('user') ?? i.user;
      const member = await ctx.guild.members.fetch(user.id).catch(() => undefined);
      const embed = goatEmbed('Message Activity').setThumbnail(user.displayAvatarURL({ extension: 'png', size: 256 }))
        .setDescription(`<@${user.id}> • **${clip(member?.displayName ?? user.displayName, 150)}**`);
      for (const [period, label] of [['daily', 'Today'], ['weekly', 'This Week'], ['monthly', 'This Month'], ['all', 'All Indexed History']] as const) {
        embed.addFields({ name: label, value: `**${ctx.db.count(ctx.guild.id, user.id, periodStart(period, ctx.config.timezone)).toLocaleString('en-US')}**`, inline: true });
      }
      embed.addFields({ name: 'Calendar', value: `Timezone: ${ctx.config.timezone}. Weeks start on Monday.` }, { name: 'Coverage', value: coverage(ctx) });
      await i.editReply({ embeds: [embed], allowedMentions: noMentions }); return;
    }
    case 'leaderboard': {
      const period = (i.options.getString('period') ?? 'weekly') as Period;
      const page = i.options.getInteger('page') ?? 1;
      const rows = ctx.db.leaderboard(ctx.guild.id, periodStart(period, ctx.config.timezone), (page - 1) * 10);
      const embed = goatEmbed('Message Leaderboard').setDescription(rows.length ? rows.map((r, n) => `**${(page - 1) * 10 + n + 1}.** <@${r.author_id}> — **${r.n.toLocaleString('en-US')}** messages`).join('\n') : 'No indexed messages in this period or page.')
        .addFields({ name: 'Period', value: `${period} • page ${page} • ${ctx.config.timezone}` }, { name: 'Coverage', value: coverage(ctx) });
      await i.editReply({ embeds: [embed], allowedMentions: noMentions }); return;
    }
    case 'giveaway-list': {
      const rows = ctx.db.all<GiveawayRow>('SELECT * FROM giveaways WHERE guild_id=? ORDER BY created_at DESC LIMIT 15', ctx.guild.id);
      await reply('Giveaways', rows.map(g => `\`${g.id}\` • **${clip(g.title, 90)}**\n${g.state} • ${stamp(g.ends_at, 'R')}${g.error ? ' • needs attention' : ''}`).join('\n\n') || 'No giveaways yet. Use /giveway-create.'); return;
    }
    case 'giveaway-end': await ctx.giveaways.end(i.options.getString('id', true), i.user.id); await reply('Giveaway Ended', 'The saved draw has been completed.'); return;
    case 'giveaway-reroll': await ctx.giveaways.reroll(i.options.getString('id', true), i.user.id); await reply('Giveaway Rerolled', 'New winners were selected. Previous winners were excluded.'); return;
    case 'giveaway-cancel': await ctx.giveaways.cancel(i.options.getString('id', true), i.user.id, reason(i)); await reply('Giveaway Cancelled', 'No additional winner was drawn.'); return;
    case 'ban': case 'mute': case 'unmute': case 'warn': {
      const user = i.options.getUser('user', true);
      const result = name === 'ban' ? await ctx.moderation.ban(user, i.user.id, reason(i), i.options.getString('duration') ?? undefined) :
        name === 'mute' ? await ctx.moderation.mute(user, i.user.id, reason(i), i.options.getString('duration', true)) :
          name === 'unmute' ? await ctx.moderation.unmute(user, i.user.id, reason(i)) : await ctx.moderation.warn(user, i.user.id, reason(i));
      await i.editReply({ embeds: [goatEmbed('Moderation Applied', colors.green).setDescription(`Action: **${name}**\nMember: <@${user.id}>`)
        .addFields({ name: 'Case', value: `#${result.caseId}` }, { name: 'DM Delivery', value: result.dm })], allowedMentions: noMentions }); return;
    }
    case 'unban': {
      const id = await ctx.moderation.unban(i.options.getString('user-id', true), i.user.id, reason(i));
      await reply('Ban Removed', `Case #${id} has been recorded.`); return;
    }
    case 'warnings': {
      const user = i.options.getUser('user', true);
      const rows = ctx.db.all<CaseRow>("SELECT * FROM moderation_cases WHERE guild_id=? AND user_id=? AND action='warn' AND status='applied' ORDER BY id DESC LIMIT 10", ctx.guild.id, user.id);
      await reply('Member Warnings', rows.map(r => `**#${r.id}** • ${stamp(r.created_at, 'f')} • <@${r.moderator_id}>\n${clip(r.reason, 200)}`).join('\n\n') || 'This member has no recorded GOAT warnings.'); return;
    }
    case 'case': {
      const r = ctx.db.get<CaseRow>('SELECT * FROM moderation_cases WHERE id=? AND guild_id=?', i.options.getInteger('id', true), ctx.guild.id);
      if (!r) throw new UserError('Case not found.');
      await i.editReply({ embeds: [goatEmbed(`Case #${r.id}`).addFields({ name: 'Action', value: r.action, inline: true }, { name: 'Status', value: r.status, inline: true },
        { name: 'User', value: `<@${r.user_id}>\n\`${r.user_id}\`` }, { name: 'Moderator', value: `<@${r.moderator_id}>\n\`${r.moderator_id}\`` },
        { name: 'Reason', value: clip(r.reason, 1000) }, { name: 'Created', value: stamp(r.created_at) }, { name: 'Expires', value: r.expires_at ? stamp(r.expires_at) : 'Not scheduled' },
        { name: 'DM', value: r.dm_status })], allowedMentions: noMentions }); return;
    }
    case 'history-sync': {
      if (i.options.getSubcommand() === 'start' && !ctx.history.running) void ctx.history.run();
      await reply('History Import', `${ctx.history.progress}\n\n${coverage(ctx)}`); return;
    }
    case 'username-retry': await reply('Username Retry', `${ctx.usernames.retryBlocked()} blocked submissions have been queued for another attempt.`); return;
    case 'username-remove': {
      await ctx.usernames.remove(i.options.getString('message-id', true), i.user.id, reason(i));
      await reply('Username Removed', 'The archive was removed and the reason was logged.'); return;
    }
    case 'nickname-sync': await ctx.nicknames.syncAll(); await reply('Nickname Sync', 'Accessible clan members have been checked. Members above the bot and the server owner cannot be renamed by Discord.'); return;
    case 'autorole-sync': await reply('Autorole Sync', `${await ctx.members.syncRoles()} members queued. Roles will be assigned while GOAT runs.`); return;
    case 'ticket-panel': await ctx.tickets.ensurePanel(true); await reply('Tickets', 'The ticket panel is ready.'); return;
    case 'ticket-repair': await ctx.tickets.syncPermissions(); await reply('Tickets', 'Ticket permissions are being checked against the configured access.'); return;
    case 'ticket-add': case 'ticket-remove': {
      await ctx.tickets.participant(i.channelId, i.options.getUser('user', true).id, i.user.id, name === 'ticket-remove');
      await reply('Ticket', name === 'ticket-remove' ? 'Participant removed.' : 'Participant added.'); return;
    }
    case 'ticket-close': {
      const ticket = ctx.tickets.fromChannel(i.channelId);
      if (!ticket) throw new UserError('Use this command inside a GOAT ticket.');
      await ctx.tickets.close(ticket.id, i.user.id, reason(i));
      await reply('Ticket', 'Ticket closed. Its transcript is queued for Ticket Logs.'); return;
    }
    case 'ticket-list': {
      const tickets = ctx.db.all<TicketRow>('SELECT * FROM tickets WHERE guild_id=? ORDER BY id DESC LIMIT 15', ctx.guild.id);
      await reply('Tickets', tickets.map(ticket => `**#${ticket.id}** • ${ticket.kind === 'application' ? 'Clan Application' : 'Support'} • ${ticket.state}\n<@${ticket.owner_id}>${ticket.channel_id && ticket.state !== 'deleted' ? ` • <#${ticket.channel_id}>` : ''}`).join('\n\n') || 'No tickets yet.'); return;
    }
    case 'welcome-preview': {
      const member = await ctx.guild.members.fetch(i.user.id);
      let avatar: Buffer | undefined;
      try { const r = await fetch(member.displayAvatarURL({ extension: 'png', size: 256 }), { signal: AbortSignal.timeout(8000) }); if (r.ok) avatar = Buffer.from(await r.arrayBuffer()); } catch { /* Use the GOAT fallback avatar. */ }
      await i.editReply({ embeds: [goatEmbed('Welcome Preview').setImage('attachment://goat-welcome.png')],
        files: [new AttachmentBuilder(await renderWelcome(member.displayName, ctx.guild.memberCount, avatar), { name: 'goat-welcome.png' })], allowedMentions: noMentions }); return;
    }
    case 'goat-status': {
      const pending = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM username_archives WHERE state IN ('pending','published','blocked')")!.n;
      const live = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM giveaways WHERE guild_id=? AND state IN ('active','ending','publishing')", ctx.guild.id)!.n;
      const tickets = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM tickets WHERE guild_id=? AND state IN ('creating','open','closing','reopening')", ctx.guild.id)!.n;
      const roles = ctx.db.get<{ n: number }>("SELECT COUNT(*) n FROM autorole_jobs WHERE guild_id=? AND status='pending'", ctx.guild.id)!.n;
      await i.editReply({ embeds: [goatEmbed('System Status', colors.green).addFields({ name: 'Uptime', value: humanDuration(Date.now() - ctx.startedAt), inline: true },
        { name: 'Gateway', value: `${ctx.client.ws.ping} ms`, inline: true }, { name: 'Queued Logs', value: String(ctx.logs.pending()), inline: true },
        { name: 'Username Jobs', value: String(pending), inline: true }, { name: 'Live Giveaways', value: String(live), inline: true },
        { name: 'Active Tickets', value: String(tickets), inline: true }, { name: 'Autorole Queue', value: String(roles), inline: true },
        { name: 'History', value: coverage(ctx) }, { name: 'Current Task', value: ctx.history.progress },
        { name: 'Thread Coverage', value: ctx.db.meta('history_thread_warning') ?? 'No enumeration error recorded' })], allowedMentions: noMentions }); return;
    }
    case 'help': {
      const staff = await isStaff(i, ctx.config);
      const description = '**Activity**\n/messages [user]\n/leaderboard [period] [page]\n\n**Giveaway Entry**\nUse Enter Giveaway. Your private confirmation lets you leave.\n\n**Tickets**\nUse Clan Application or Support on the ticket panel.' +
        (staff ? '\n\n**GOAT Tools**\n/giveway-create (also /giveaway-create)\n/giveaway-list • /giveaway-end • /giveaway-reroll • /giveaway-cancel\n/ban • /unban • /mute • /unmute • /warn • /warnings • /case\n/history-sync • /username-retry • /username-remove\n/nickname-sync • /autorole-sync • /welcome-preview • /goat-status\n/ticket-panel • /ticket-list • /ticket-add • /ticket-remove • /ticket-close • /ticket-repair' : '');
      await reply('Commands', description); return;
    }
    default: throw new UserError('This command is not registered in the current GOAT version.');
  }
}
function reason(i: ChatInputCommandInteraction): string {
  const value = i.options.getString('reason', true).trim();
  if (!value) throw new UserError('Enter a non-empty reason.');
  return value;
}
export async function routeInteraction(ctx: Context, i: Interaction): Promise<void> {
  if (i.guildId !== ctx.guild.id) return;
  try {
    if (i.isAutocomplete()) {
      if (!(await isStaff(i, ctx.config))) { await i.respond([]); return; }
      const query = String(i.options.getFocused()).toLowerCase();
      const rows = ctx.db.all<GiveawayRow>('SELECT * FROM giveaways WHERE guild_id=? ORDER BY created_at DESC LIMIT 200', ctx.guild.id)
        .filter(g => g.id.includes(query) || g.title.toLowerCase().includes(query)).slice(0, 25);
      await i.respond(rows.map(g => ({ name: clip(`${g.title} • ${g.state} • ${g.id}`, 100), value: g.id }))); return;
    }
    if (i.isChatInputCommand()) { await command(ctx, i); return; }
    if (i.isModalSubmit()) {
      const [brand, system, action, id] = i.customId.split(':');
      if (brand === 'goat' && system === 'giveaway' && action === 'modal' && id) {
        await requireStaff(i, ctx.config); await ctx.giveaways.submit(i, id);
      }
      if (brand === 'goat' && system === 'ticket' && action === 'close-modal' && id) await ctx.tickets.closeModal(i, id);
      return;
    }
    if (i.isButton()) {
      const [brand, system, action, id] = i.customId.split(':');
      if (brand !== 'goat' || !id) return;
      if (system === 'ticket') { await ctx.tickets.button(i, action, id); return; }
      if (system === 'giveaway' && (action === 'enter' || action === 'leave')) { await ctx.giveaways.entry(i, id, action === 'leave'); return; }
      await requireStaff(i, ctx.config);
      if (system === 'log' && action === 'user') { await i.reply({ embeds: [goatEmbed('User ID').setDescription(`\`${id}\``)], flags: MessageFlags.Ephemeral, allowedMentions: noMentions }); return; }
      if (system === 'giveaway' && ['edit', 'publish', 'discard'].includes(action)) { await ctx.giveaways.draftAction(i, action, id); return; }
      throw new UserError('This GOAT button is no longer available.');
    }
  } catch (err) {
    if (i.isAutocomplete()) { await i.respond([]).catch(() => undefined); return; }
    if (!i.isRepliable()) return;
    let message = err instanceof UserError ? err.message : 'GOAT could not complete this action. Check the bot’s channel permissions and role order, then try again.';
    if (errorCode(err) === 50013 || errorCode(err) === 50001) message = 'GOAT cannot access that resource. Check channel permissions and place the bot role above the members it manages.';
    if (!(err instanceof UserError)) ctx.logger.error({ interactionId: i.id, error: errorText(err) }, 'GOAT interaction failed');
    const response = { embeds: [goatEmbed('Action Unavailable', colors.orange).setDescription(message)], allowedMentions: noMentions };
    try {
      if (i.deferred) await i.editReply(response);
      else if (i.replied) await i.followUp({ ...response, flags: MessageFlags.Ephemeral });
      else await i.reply({ ...response, flags: MessageFlags.Ephemeral });
    } catch (replyError) { ctx.logger.warn({ error: errorText(replyError) }, 'GOAT interaction response expired'); }
  }
}
