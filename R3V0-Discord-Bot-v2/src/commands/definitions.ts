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
  create('giveway-create'), create('giveaway-create'),
  giveawayId('giveaway-end', 'End a GOAT giveaway and draw winners now'),
  giveawayId('giveaway-reroll', 'Draw new winners, excluding previous GOAT winners'),
  giveawayId('giveaway-cancel', 'Cancel a GOAT giveaway without selecting winners')
    .addStringOption(o => o.setName('reason').setDescription('Cancellation reason').setRequired(true).setMaxLength(1000)),
  new SlashCommandBuilder().setName('giveaway-list').setDescription('List recent GOAT giveaways and their IDs'),
  new SlashCommandBuilder().setName('messages').setDescription('View daily, weekly, monthly and lifetime GOAT message totals')
    .addUserOption(o => o.setName('user').setDescription('Member (default: yourself)')),
  new SlashCommandBuilder().setName('leaderboard').setDescription('View the GOAT message leaderboard')
    .addStringOption(o => o.setName('period').setDescription('Calendar period').addChoices(...periods))
    .addIntegerOption(o => o.setName('page').setDescription('Page number').setMinValue(1).setMaxValue(10000)),
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
  new SlashCommandBuilder().setName('ticket-panel').setDescription('Publish or repair the GOAT ticket panel'),
  new SlashCommandBuilder().setName('ticket-list').setDescription('Show recent GOAT tickets'),
  new SlashCommandBuilder().setName('ticket-add').setDescription('Add a member to the current GOAT ticket')
    .addUserOption(option => option.setName('user').setDescription('Member to add').setRequired(true)),
  new SlashCommandBuilder().setName('ticket-remove').setDescription('Remove a participant from the current GOAT ticket')
    .addUserOption(option => option.setName('user').setDescription('Member to remove').setRequired(true)),
  new SlashCommandBuilder().setName('ticket-close').setDescription('Close the current GOAT ticket and save its transcript')
    .addStringOption(option => option.setName('reason').setDescription('Closing reason').setRequired(true).setMaxLength(1000)),
  ...['ticket-approve', 'ticket-reject'].map(name => new SlashCommandBuilder().setName(name).setDescription(name === 'ticket-approve' ? 'Accept the current clan application and notify the applicant' : 'Reject the current clan application and notify the applicant')
    .addStringOption(option => option.setName('reason').setDescription('Reason included in the applicant DM').setRequired(true).setMaxLength(1000))),
  new SlashCommandBuilder().setName('ticket-repair').setDescription('Restore configured privacy permissions for GOAT tickets'),
  new SlashCommandBuilder().setName('welcome-preview').setDescription('Preview the GOAT welcome card privately'),
  new SlashCommandBuilder().setName('goat-status').setDescription('View GOAT health, queued logs and database status'),
  new SlashCommandBuilder().setName('help').setDescription('Show GOAT commands')
];
export const publicCommands = new Set(['messages', 'leaderboard', 'help']);
