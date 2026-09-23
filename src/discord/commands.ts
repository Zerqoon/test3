import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

export const commandData = [
  // 1. WHITELIST MANAGEMENT
  new SlashCommandBuilder()
    .setName('whitelist')
    .setDescription('Manage tracked clans on the whitelist')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand => subcommand
      .setName('add')
      .setDescription('Add a clan to tracking and index its members')
      .addStringOption(option => option.setName('clan').setDescription('Clan name tag').setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('remove')
      .setDescription('Remove a clan from tracking')
      .addStringOption(option => option.setName('clan').setDescription('Clan name tag').setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('list')
      .setDescription('Display all currently tracked clans'))
    .addSubcommand(subcommand => subcommand
      .setName('refresh')
      .setDescription('Force an immediate sync with BIG Games API')
      .addStringOption(option => option.setName('clan').setDescription('Clan name tag').setRequired(true))),

  // 2. CLAN DATA & LEADERBOARDS
  new SlashCommandBuilder()
    .setName('clan')
    .setDescription('Clan metrics, battle progress, and rosters')
    .addSubcommand(subcommand => subcommand
      .setName('info')
      .setDescription('Overview of active battle stats and diamond vaults')
      .addStringOption(option => option.setName('clan').setDescription('Clan name (defaults to MAIN_CLAN)')))
    .addSubcommand(subcommand => subcommand
      .setName('members')
      .setDescription('Interactive paginated clan member leaderboard')
      .addStringOption(option => option.setName('clan').setDescription('Clan name'))
      .addIntegerOption(option => option.setName('page').setDescription('Starting page number').setMinValue(1)))
    .addSubcommand(subcommand => subcommand
      .setName('history')
      .setDescription('Clan battle points timeline and historical velocity')
      .addStringOption(option => option.setName('clan').setDescription('Clan name'))
      .addIntegerOption(option => option.setName('hours').setDescription('Historical range in hours (1-168)').setMinValue(1).setMaxValue(168)))
    .addSubcommand(subcommand => subcommand
      .setName('leaderboard')
      .setDescription('Global official BIG Games clan leaderboard')
      .addIntegerOption(option => option.setName('page').setDescription('Leaderboard page number').setMinValue(1))),

  // 3. PLAYER METRICS
  new SlashCommandBuilder()
    .setName('player')
    .setDescription('Tracked player statistics and battle analytics')
    .addSubcommand(subcommand => subcommand
      .setName('info')
      .setDescription('Player profile, battle points, and deposited diamonds')
      .addStringOption(option => option.setName('player').setDescription('Roblox Username or UserID').setRequired(true))
      .addStringOption(option => option.setName('clan').setDescription('Optional clan hint')))
    .addSubcommand(subcommand => subcommand
      .setName('history')
      .setDescription('Hourly velocity chart with interactive timeframe switches')
      .addStringOption(option => option.setName('player').setDescription('Roblox Username or UserID').setRequired(true))
      .addIntegerOption(option => option.setName('hours').setDescription('Hour range (1-168)').setMinValue(1).setMaxValue(168))
      .addStringOption(option => option.setName('clan').setDescription('Optional clan hint')))
    .addSubcommand(subcommand => subcommand
      .setName('track')
      .setDescription('Enable high-priority tracking for a player')
      .addStringOption(option => option.setName('player').setDescription('Roblox Username or UserID').setRequired(true))
      .addStringOption(option => option.setName('clan').setDescription('Target clan tag').setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('untrack')
      .setDescription('Disable high-priority tracking for a player')
      .addStringOption(option => option.setName('player').setDescription('Roblox Username or UserID').setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('tracked')
      .setDescription('List all priority-tracked players')),

  // 4. QUICK 24H HISTORY
  new SlashCommandBuilder()
    .setName('history')
    .setDescription('Quick 24h performance chart for the main clan or a player')
    .addStringOption(option => option
      .setName('player')
      .setDescription('Optional player username/ID; leave empty for primary clan')),

  // 5. BATTLE DASHBOARDS & COMPARISONS
  new SlashCommandBuilder()
    .setName('battle')
    .setDescription('Clan battle analytics and performance telemetry')
    .addSubcommand(subcommand => subcommand
      .setName('clan')
      .setDescription('Full graphical clan battle overview')
      .addStringOption(option => option.setName('clan').setDescription('Clan name'))
      .addIntegerOption(option => option.setName('hours').setDescription('Hour range (1-168)').setMinValue(1).setMaxValue(168)))
    .addSubcommand(subcommand => subcommand
      .setName('player')
      .setDescription('Player hourly velocity telemetry dashboard')
      .addStringOption(option => option.setName('player').setDescription('Roblox Username or UserID').setRequired(true))
      .addIntegerOption(option => option.setName('hours').setDescription('Hour range (1-168)').setMinValue(1).setMaxValue(168))
      .addStringOption(option => option.setName('clan').setDescription('Optional clan hint')))
    .addSubcommand(subcommand => subcommand
      .setName('compare')
      .setDescription('Head-to-head battle points comparison between two clan members')
      .addStringOption(option => option.setName('player1').setDescription('First player username or UserID').setRequired(true))
      .addStringOption(option => option.setName('player2').setDescription('Second player username or UserID').setRequired(true))
      .addStringOption(option => option.setName('clan').setDescription('Optional clan hint'))),

  // 6. GAME TOOLS (RAP & FULL MASTERY CALCULATOR)
  new SlashCommandBuilder()
    .setName('game')
    .setDescription('Pet Simulator 99 utility engines and RAP database')
    .addSubcommand(subcommand => subcommand
      .setName('rap')
      .setDescription('Check item RAP value with price deltas and official artwork')
      .addStringOption(option => option.setName('item').setDescription('Item or pet name').setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('mastery')
      .setDescription('Mastery Calculator: required XP, item quantities, and diamond costs')
      .addStringOption(option => option
        .setName('type')
        .setDescription('Select mastery skill')
        .setRequired(true)
        .addChoices(
          { name: '🍎 Fruits', value: 'fruit' },
          { name: '🧪 Potions', value: 'potions' },
          { name: '📖 Enchants', value: 'enchants' },
          { name: '🗝️ Keys', value: 'keys' },
          { name: '🥚 Eggs', value: 'eggs' },
          { name: '🧬 Pets & Fusing', value: 'fusing' },
          { name: '📦 Breakables', value: 'breakables' },
          { name: '☀️ Daycare', value: 'daycare' },
          { name: '🎣 Fishing', value: 'fishing' }
        ))
      .addIntegerOption(option => option
        .setName('start_level')
        .setDescription('Starting level (e.g. 1 or 80)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(98))
      .addIntegerOption(option => option
        .setName('end_level')
        .setDescription('Target level (e.g. 99)')
        .setRequired(true)
        .setMinValue(2)
        .setMaxValue(99))
      .addBooleanOption(option => option
        .setName('clan_boost')
        .setDescription('Apply 10% Clan XP Boost reduction? (Default: Yes)'))),

  // 7. BOT & HEALTH METRICS
  new SlashCommandBuilder()
    .setName('bot')
    .setDescription('System telemetry and operational health')
    .addSubcommand(subcommand => subcommand
      .setName('status')
      .setDescription('Display background scheduler status and SQLite storage metrics')),

  // 8. ADMIN & LOGGING CONFIGURATION
  new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Server administrative controls and tracker settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand => subcommand
      .setName('set-main-clan')
      .setDescription('Configure primary default clan for this server')
      .addStringOption(option => option.setName('clan').setDescription('Clan tag').setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('set-logs-channel')
      .setDescription('Set channel for automated position changes and diamond donations')
      .addChannelOption(option => option
        .setName('channel')
        .setDescription('Select target text channel')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)))
    .addSubcommand(subcommand => subcommand
      .setName('diagnostics')
      .setDescription('Execute full connectivity audit (BIG Games API, SQLite, and snapshots)')),

  // 9. UTILITY: CHANNEL CLEANUP (PURGE / CLEAR)
  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Bulk delete messages from this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(option => option
      .setName('amount')
      .setDescription('Number of messages to delete (1-100)')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(100))
    .addUserOption(option => option
      .setName('user')
      .setDescription('Optional: only purge messages from this specific user or bot'))
].map(command => command.toJSON());
