import { ChannelType, SlashCommandBuilder } from 'discord.js';

const periods = [
  { name: 'Daily — today', value: 'daily' }, { name: 'Weekly — Monday to now', value: 'weekly' },
  { name: 'Monthly — this month', value: 'monthly' }, { name: 'All indexed history', value: 'all' }
];
const create = (name: string) => new SlashCommandBuilder().setName(name).setDescription('Open the GOAT giveaway creation form')
  .addIntegerOption(o => o.setName('winners').setDescription('Number of winners (default: 1)').setMinValue(1).setMaxValue(20))
  .addChannelOption(o => o.setName('channel').setDescription('Publication channel (default: this channel)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
  .addIntegerOption(o => o.setName('min-messages').setDescription('Optional minimum indexed message count').setMinValue(0).setMaxValue(1_000_000))
  .addStringOption(o => o.setName('message-period').setDescription('Period for the activity requirement').addChoices(...periods));
const giveawayId = (name: string, description: string) => new SlashCommandBuilder().setName(name).setDescription(description)
  .addStringOption(o => o.setName('id').setDescription('GOAT giveaway ID').setRequired(true).setAutocomplete(true));
const targetReason = (name: string, description: string) => new SlashCommandBuilder().setName(name).setDescription(description)
  .addUserOption(o => o.setName('user').setDescription('Member to moderate').setRequired(true))
  .addStringOption(o => o.setName('reason').setDescription('Reason included in the GOAT log and DM').setRequired(true).setMaxLength(1000));

// Commands remain visible so the configured owner can invoke them without any role.
// Every privileged command, modal and button is guarded again at runtime.
export const commandDefinitions = [
  new SlashCommandBuilder().setName('value').setDescription('Check a current Pet Universe value with artwork and variants')
    .addStringOption(o => o.setName('name').setDescription('Start typing a pet name and choose a suggestion').setRequired(true).setAutocomplete(true).setMinLength(1).setMaxLength(180))
    .addStringOption(o => o.setName('variant').setDescription('Pet variant (default: Normal)').addChoices(
      { name: 'Normal', value: 'normal' }, { name: 'Golden', value: 'golden' }, { name: 'Diamond', value: 'diamond' }))
    .addStringOption(o => o.setName('category').setDescription('Collection (default: Pets)').addChoices(
      { name: 'Pets', value: 'pets' }, { name: 'Charms', value: 'charms' }, { name: 'Eggs', value: 'eggs' }, { name: 'Items', value: 'items' })),
  new SlashCommandBuilder().setName('embed').setDescription('Create an embed with outside text, an image, color and optional selected ping')
    .addChannelOption(option => option.setName('channel').setDescription('Where to send it (default: this channel)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addRoleOption(option => option.setName('ping-role').setDescription('Optional role to mention'))
    .addUserOption(option => option.setName('ping-user').setDescription('Optional person to mention')),
  create('giveway-create'), create('giveaway-create'),
  giveawayId('giveaway-end', 'End a GOAT giveaway and draw winners now'),
  giveawayId('giveaway-reroll', 'Draw new winners, excluding previous GOAT winners'),
  giveawayId('giveaway-cancel', 'Cancel a GOAT giveaway without selecting winners')
    .addStringOption(o => o.setName('reason').setDescription('Cancellation reason').setRequired(true).setMaxLength(1000)),
  new SlashCommandBuilder().setName('giveaway-list').setDescription('List recent GOAT giveaways and their IDs'),
  new SlashCommandBuilder().setName('messages').setDescription('View daily, weekly, monthly and lifetime GOAT message totals')
    .addUserOption(o => o.setName('user').setDescription('Member (default: yourself)')),
  ...['leaderboard', 'leadboard'].map(name => new SlashCommandBuilder().setName(name).setDescription('View the GOAT message leaderboard')
    .addStringOption(o => o.setName('period').setDescription('Calendar period').addChoices(...periods))
    .addIntegerOption(o => o.setName('page').setDescription('Page number').setMinValue(1).setMaxValue(10000))),
  targetReason('ban', 'Ban a member with a GOAT reason and DM notice')
    .addStringOption(o => o.setName('duration').setDescription('Optional temporary ban: 10m, 1 day, 1w (otherwise permanent)').setMaxLength(100)),
  targetReason('mute', 'Apply a Discord timeout with a GOAT reason and DM notice')
    .addStringOption(o => o.setName('duration').setDescription('1s, 10m, 1 hour, 1h 30m (maximum: 28 days)').setRequired(true).setMaxLength(100)),
  targetReason('unmute', 'Remove a Discord timeout and send a GOAT DM'),
  targetReason('warn', 'Record a GOAT warning and send a DM'),
  new SlashCommandBuilder().setName('unban').setDescription('Remove a GOAT or server ban')
    .addStringOption(o => o.setName('user-id').setDescription('Discord user ID').setRequired(true).setMinLength(17).setMaxLength(20))
    .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(1000)),
  new SlashCommandBuilder().setName('warnings').setDescription('View the last ten GOAT warnings for a member')
    .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true)),
  new SlashCommandBuilder().setName('case').setDescription('View a GOAT moderation case')
    .addIntegerOption(o => o.setName('id').setDescription('Case number').setRequired(true).setMinValue(1)),
  new SlashCommandBuilder().setName('history-sync').setDescription('Manage GOAT historical message import')
    .addSubcommand(o => o.setName('start').setDescription('Import / resume all available message history'))
    .addSubcommand(o => o.setName('status').setDescription('Show coverage and import progress')),
  new SlashCommandBuilder().setName('username-retry').setDescription('Retry blocked GOAT username conversions'),
  new SlashCommandBuilder().setName('username-remove').setDescription('Remove a locked GOAT username submission')
    .addStringOption(o => o.setName('message-id').setDescription('ID of the bot-owned archive message').setRequired(true).setMinLength(17).setMaxLength(20))
    .addStringOption(o => o.setName('reason').setDescription('Reason recorded in the GOAT log').setRequired(true).setMaxLength(1000)),
  new SlashCommandBuilder().setName('nickname-sync').setDescription('Refresh GOAT clan nickname tags'),
  new SlashCommandBuilder().setName('autorole-sync').setDescription('Assign the GOAT member role to existing human members'),
  new SlashCommandBuilder().setName('ticket').setDescription('Manage applications and support tickets')
    .addSubcommand(s => s.setName('panel').setDescription('Publish or refresh the ticket panel'))
    .addSubcommand(s => s.setName('list').setDescription('View recent tickets and their status'))
    .addSubcommand(s => s.setName('add').setDescription('Add a person to this ticket')
      .addUserOption(o => o.setName('user').setDescription('Person to add').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove a participant from this ticket')
      .addUserOption(o => o.setName('user').setDescription('Person to remove').setRequired(true)))
    .addSubcommand(s => s.setName('close').setDescription('Close this ticket and save the conversation')
      .addStringOption(o => o.setName('reason').setDescription('Closing reason').setRequired(true).setMaxLength(1000)))
    .addSubcommand(s => s.setName('reopen').setDescription('Reopen a closed ticket as staff, including outside Support hours')
      .addIntegerOption(o => o.setName('id').setDescription('Ticket number; default: this channel').setMinValue(1)))
    .addSubcommand(s => s.setName('delete').setDescription('Delete a closed ticket after its transcript has been delivered')
      .addBooleanOption(o => o.setName('confirm').setDescription('Select True to confirm deleting the closed channel').setRequired(true))
      .addIntegerOption(o => o.setName('id').setDescription('Ticket number; default: this channel').setMinValue(1)))
    .addSubcommand(s => s.setName('start-vote').setDescription('Start the 3-minute application vote'))
    .addSubcommand(s => s.setName('approve').setDescription('Accept this application and notify the applicant')
      .addStringOption(o => o.setName('reason').setDescription('Reason included in the applicant DM').setRequired(true).setMaxLength(1000)))
    .addSubcommand(s => s.setName('reject').setDescription('Reject this application and notify the applicant')
      .addStringOption(o => o.setName('reason').setDescription('Reason included in the applicant DM').setRequired(true).setMaxLength(1000)))
    .addSubcommand(s => s.setName('repair').setDescription('Restore ticket privacy permissions')),
  new SlashCommandBuilder().setName('ticket-panel').setDescription('Publish or repair the GOAT ticket panel'),
  new SlashCommandBuilder().setName('clan-off').setDescription('Pause new clan applications and remove the application button'),
  new SlashCommandBuilder().setName('support-open').setDescription('Staff: open a private Support ticket for a member, even outside opening hours')
    .addUserOption(o => o.setName('user').setDescription('Member who needs help').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Why staff are opening this ticket; included in the ticket and log').setRequired(true).setMinLength(1).setMaxLength(1000))
    .addStringOption(o => o.setName('username').setDescription('Optional Roblox @username for this member').setMinLength(3).setMaxLength(21)),
  new SlashCommandBuilder().setName('rules-refresh').setDescription('Publish or refresh the English community rules in the configured channel'),
  new SlashCommandBuilder().setName('boost-preview').setDescription('Privately preview the server boost thank-you embed')
    .addUserOption(o => o.setName('user').setDescription('Member shown in the preview; default: yourself')),
  new SlashCommandBuilder().setName('open-ticket').setDescription('Set free clan places; use count:0 to mark the clan full')
    .addIntegerOption(o => o.setName('count').setDescription('Free places (0–20); 0 marks the clan full and removes the application button').setRequired(true).setMinValue(0).setMaxValue(20)),
  new SlashCommandBuilder().setName('clan-status').setDescription('View free clan places, occupied places and reserved applications'),
  new SlashCommandBuilder().setName('ticket-list').setDescription('Show recent GOAT tickets'),
  new SlashCommandBuilder().setName('ticket-add').setDescription('Add a member to the current GOAT ticket')
    .addUserOption(option => option.setName('user').setDescription('Member to add').setRequired(true)),
  new SlashCommandBuilder().setName('ticket-remove').setDescription('Remove a participant from the current GOAT ticket')
    .addUserOption(option => option.setName('user').setDescription('Member to remove').setRequired(true)),
  new SlashCommandBuilder().setName('ticket-close').setDescription('Close the current GOAT ticket and save its transcript')
    .addStringOption(option => option.setName('reason').setDescription('Closing reason').setRequired(true).setMaxLength(1000)),
  new SlashCommandBuilder().setName('ticket-start-vote').setDescription('Start the 3-minute vote for the current clan application'),
  ...['ticket-approve', 'ticket-reject'].map(name => new SlashCommandBuilder().setName(name).setDescription(name === 'ticket-approve' ? 'Accept the current clan application and notify the applicant' : 'Reject the current clan application and notify the applicant')
    .addStringOption(option => option.setName('reason').setDescription('Reason included in the applicant DM').setRequired(true).setMaxLength(1000))),
  new SlashCommandBuilder().setName('ticket-repair').setDescription('Restore configured privacy permissions for GOAT tickets'),
  new SlashCommandBuilder().setName('welcome-preview').setDescription('Preview the GOAT welcome card privately'),
  new SlashCommandBuilder().setName('goat-status').setDescription('View GOAT health, queued logs and database status'),
  new SlashCommandBuilder().setName('message-logs').setDescription('Inspect and test GOAT message log delivery')
    .addSubcommand(s => s.setName('status').setDescription('Check the message log destination, permissions and Gateway events'))
    .addSubcommand(s => s.setName('test').setDescription('Send one delivery test to the configured message log channel'))
    .addSubcommand(s => s.setName('retry').setDescription('Retry saved message logs after repairing permissions')),
  new SlashCommandBuilder().setName('link-filter').setDescription('Inspect link rules, approved GIF providers and exceptions')
    .addSubcommand(s => s.setName('status').setDescription('Show approved providers, GIF channels, role exceptions and queues'))
    .addSubcommand(s => s.setName('allow-role').setDescription('Allow a role to send GIFs from any source; invites remain restricted')
      .addRoleOption(o => o.setName('role').setDescription('Role allowed to send any GIF').setRequired(true)))
    .addSubcommand(s => s.setName('remove-role').setDescription('Remove the GIF exception from a role')
      .addRoleOption(o => o.setName('role').setDescription('Role to remove from the GIF exceptions').setRequired(true))),
  new SlashCommandBuilder().setName('help').setDescription('Browse commands and instructions by category')
].map(command => command.setDefaultMemberPermissions(null));
export const publicCommands = new Set(['messages', 'leaderboard', 'leadboard', 'help', 'value']);
