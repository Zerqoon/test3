import {
  Client,
  GatewayIntentBits,
  Events,
  ActivityType
} from 'discord.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { BigGamesClient } from './api/BigGamesClient.js';
import { RobloxClient } from './api/RobloxClient.js';
import { WhitelistService } from './services/WhitelistService.js';
import { HistoryService } from './services/HistoryService.js';
import { PlayerService } from './services/PlayerService.js';
import { RapService } from './services/RapService.js';
import { TrackerScheduler } from './jobs/TrackerScheduler.js';
import { handleCommand } from './discord/handler.js';
import type { AppContext } from './discord/context.js';

async function bootstrap() {
  logger.info('[BOOT] Inicjalizacja bota R3V0 PS99 Tracker...');

  const bigGames = new BigGamesClient();
  const roblox = new RobloxClient();
  
  // WhitelistService przyjmuje (bigGames, roblox):
  const whitelist = new WhitelistService(bigGames, roblox);
  const history = new HistoryService();
  const player = new PlayerService(roblox, whitelist);
  const rap = new RapService(bigGames);
  const scheduler = new TrackerScheduler(whitelist, history);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages
    ]
  });

  scheduler.setClient(client);

  const ctx: AppContext = {
    big: bigGames,
    roblox,
    whitelist,
    history,
    player,
    rap,
    scheduler
  };

  client.once(Events.ClientReady, async (c) => {
    logger.info(`[READY] Zalogowano pomyślnie jako ${c.user.tag} (ID: ${c.user.id})`);

    c.user.setPresence({
      activities: [{ name: 'PS99 • /battle clan', type: ActivityType.Watching }],
      status: 'online'
    });

    try {
      await scheduler.start();
      logger.info('[TRACKER] Scheduler pomyślnie wystartował w tle.');
    } catch (err) {
      logger.error({ error: String(err) }, '[TRACKER] Błąd startu schedulera');
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
      await handleCommand(interaction, ctx);
    } catch (error) {
      logger.error(
        {
          command: interaction.commandName,
          user: interaction.user.tag,
          error: error instanceof Error ? error.message : String(error)
        },
        '[INTERACTION] Błąd wykonania polecenia'
      );

      const errorMessage = 'Wystąpił nieoczekiwany błąd podczas przetwarzania komendy.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: `❌ ${errorMessage}` }).catch(() => {});
      } else {
        await interaction.reply({ content: `❌ ${errorMessage}`, ephemeral: true }).catch(() => {});
      }
    }
  });

  const shutdown = async (signal: string) => {
    logger.info(`[SHUTDOWN] Otrzymano sygnał ${signal}. Bezpieczne zamykanie...`);
    scheduler.stop();
    client.destroy();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await client.login(config.DISCORD_TOKEN);
}

bootstrap().catch((error) => {
  logger.fatal({ error: error instanceof Error ? error.stack : String(error) }, '[FATAL] Krytyczny błąd startu bota');
  process.exit(1);
});
