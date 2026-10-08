import { VERSION } from './core/version.js';
import { Client, Events, GatewayIntentBits, Partials, ActivityType, REST, Routes, Options } from 'discord.js';
import pino from 'pino';
import { assertPersistentDatabase, config, env, requireToken } from './core/config.js';
import { Store } from './core/store.js';
import { InstanceLease } from './core/lease.js';
import type { Context } from './core/types.js';
import { errorText } from './core/util.js';
import { commandDefinitions } from './commands/definitions.js';
import { LogService } from './services/logs.js';
import { HistoryService } from './services/history.js';
import { UsernameService } from './services/usernames.js';
import { NicknameService } from './services/nicknames.js';
import { GiveawayService } from './services/giveaways.js';
import { ModerationService } from './services/moderation.js';
import { AuditService } from './services/audit.js';
import { installEvents } from './events/install.js';
import { goatEmbed, colors } from './core/embeds.js';
import { maintain } from './services/maintenance.js';
import { MemberService } from './services/members.js';
import { TicketService } from './services/tickets.js';
import { EmbedService } from './services/custom-embeds.js';
import { LinkFilterService } from './services/link-filter.js';
import { RoleReminderService } from './services/role-reminders.js';
import { FilterNoticeService } from './services/filter-notices.js';
import { TemporaryMessageService } from './services/temporary-messages.js';
import { ValueService } from './services/values.js';

requireToken();
assertPersistentDatabase();
const logger = pino({ level: env.logLevel, redact: ['token', 'authorization', 'headers.authorization'] });
const db = new Store(env.databasePath);
const lease = new InstanceLease(db);
lease.acquire();
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
  makeCache: Options.cacheWithLimits({ ...Options.DefaultMakeCacheSettings, MessageManager: 100 }),
  allowedMentions: { parse: [], repliedUser: false }
});
let ctx: Context | undefined;
let exiting = false;
let maintenanceTimer: NodeJS.Timeout | undefined;
async function shutdown(code = 0): Promise<void> {
  if (exiting) return;
  exiting = true;
  if (ctx) {
    ctx.stopping = true;
    ctx.logs.stop(); ctx.history.stop(); ctx.usernames.stop(); ctx.giveaways.stop(); ctx.moderation.stop();
    ctx.members.stop(); ctx.tickets.stop(); ctx.embeds.stop(); ctx.linkFilter.stop();
    ctx.roleReminders.stop(); ctx.filterNotices.stop(); ctx.temporary.stop();
  }
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  lease.release();
  await client.destroy();
  // Interrupted jobs recover from their durable checkpoints on the next startup.
  logger.info('GOAT stopped');
  process.exit(code);
}
lease.heartbeat(() => { logger.fatal('GOAT database lease lost'); void shutdown(1); });
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
process.on('uncaughtException', err => { logger.fatal({ error: errorText(err) }, 'GOAT fatal error'); void shutdown(1); });
process.on('unhandledRejection', err => { logger.fatal({ error: errorText(err) }, 'GOAT unhandled rejection'); void shutdown(1); });
client.on(Events.Error, err => logger.error({ error: errorText(err) }, 'GOAT Discord client error'));
client.on(Events.ShardDisconnect, event => {
  if (event.code === 4014) logger.error('GOAT: enable Server Members Intent and Message Content Intent in Developer Portal > Bot.');
});
client.once(Events.ClientReady, ready => {
  void (async () => {
    const usernameChannel = await ready.channels.fetch(config.channels.usernames);
    if (!usernameChannel || !('guild' in usernameChannel)) throw new Error('GOAT cannot access the configured username channel. Check the bot invite and channel ID.');
    const guild = usernameChannel.guild;
    if (env.guildId && guild.id !== env.guildId) throw new Error('GOAT channel IDs and GUILD_ID belong to different servers.');
    ctx = { client, guild, config, db, logger, startedAt: Date.now(), stopping: false } as Context;
    ctx.logs = new LogService(ctx); ctx.usernames = new UsernameService(ctx); ctx.history = new HistoryService(ctx);
    ctx.nicknames = new NicknameService(ctx); ctx.giveaways = new GiveawayService(ctx);
    ctx.moderation = new ModerationService(ctx); ctx.audit = new AuditService(ctx);
    ctx.roleReminders = new RoleReminderService(ctx); ctx.temporary = new TemporaryMessageService(ctx);
    ctx.filterNotices = new FilterNoticeService(ctx);
    ctx.members = new MemberService(ctx); ctx.tickets = new TicketService(ctx); ctx.embeds = new EmbedService(ctx);
    ctx.linkFilter = new LinkFilterService(ctx);
    ctx.values = new ValueService({ ...config.values, siteUrl: env.valueSiteUrl });
    ctx.values.start();
    installEvents(ctx);
    // Interactive handlers and delivery workers become available before a full member preload.
    ctx.logs.start(); ctx.usernames.start(); ctx.giveaways.start(); ctx.moderation.start(); ctx.embeds.start();
    ctx.linkFilter.start(); ctx.roleReminders.start(); ctx.filterNotices.start(); ctx.temporary.start();
    ctx.members.initialize(guild.members.cache.values()); ctx.members.start(); ctx.tickets.start();
    const activeContext = ctx;
    void Promise.all([config.channels.logs, config.channels.messageLogs, config.channels.memberLogs, config.channels.welcome,
      ...(config.tickets.enabled ? [config.tickets.logChannelId, config.tickets.panelChannelId, config.tickets.voting.channelId] : [])]
      .map(async id => {
        try {
          const channel = await guild.channels.fetch(id);
          if (!channel?.isTextBased() || !('send' in channel)) throw new Error('Channel is not accessible or sendable.');
          if (!channel.permissionsFor(ready.user.id)?.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) throw new Error('GOAT needs View Channel, Send Messages and Embed Links.');
        } catch (err) { logger.warn({ channelId: id, error: errorText(err) }, 'GOAT channel access needs attention'); }
      }));
    if (config.autoRegisterCommands) {
      const rest = new REST({ version: '10' }).setToken(env.token);
      void rest.put(Routes.applicationGuildCommands(ready.user.id, guild.id), { body: commandDefinitions.map(c => c.toJSON()) })
        .then(() => logger.info({ commands: commandDefinitions.length }, 'GOAT commands registered for all members'))
        .catch(err => logger.error({ error: errorText(err) }, 'GOAT command registration failed; run npm run register after checking application access'));
    }
    ready.user.setPresence({ activities: [{ name: 'GOAT • Clan Community', type: ActivityType.Watching }], status: 'online' });
    if (config.tickets.enabled) {
      void (async () => {
        try { await activeContext.tickets.ensurePanel(); }
        catch (err) { logger.warn({ error: errorText(err) }, 'GOAT ticket panel needs attention; use /ticket-panel after checking channel access'); }
        await activeContext.tickets.syncPermissions();
      })().catch(err => logger.warn({ error: errorText(err) }, 'GOAT ticket repairs will retry'));
    }
    maintain(ctx);
    maintenanceTimer = setInterval(() => { if (ctx && !ctx.stopping) { try { maintain(ctx); } catch (err) { logger.warn({ error: errorText(err) }, 'GOAT maintenance will retry'); } } }, 3600000);
    if (!config.history.autoImport) ctx.usernames.releaseHistory();
    void (async () => {
      try { await guild.members.fetch(); }
      catch (err) {
        activeContext.members.requestInitialSync();
        logger.warn({ error: errorText(err) }, 'GOAT member preload will retry; historical author names may use global display names');
      }
      if (activeContext.stopping) return;
      activeContext.members.initialize(guild.members.cache.values());
      if (config.history.autoImport) { activeContext.history.startTimer(); void activeContext.history.run(); }
      await activeContext.nicknames.syncAll(false);
    })().catch(err => logger.warn({ error: errorText(err) }, 'GOAT background member sync will retry'));
    if (config.logging.logSystemOnline) activeContext.logs.enqueue({ embeds: [goatEmbed('System Online', colors.green).setDescription('GOAT is online. Persistent jobs have resumed.')
      .addFields({ name: 'Version', value: VERSION }).toJSON()] }, `online:${Date.now()}`);
    logger.info({ guildId: guild.id, version: VERSION }, 'GOAT ready');
  })().catch(err => { logger.fatal({ error: errorText(err) }, 'GOAT startup failed'); void shutdown(1); });
});
client.login(env.token).catch(err => { logger.fatal({ error: errorText(err) }, 'GOAT login failed; check DISCORD_TOKEN and privileged intents'); void shutdown(1); });
