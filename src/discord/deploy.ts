import { REST, Routes, type RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';
import { pathToFileURL } from 'node:url';
import { commandData } from './commands.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

interface DeployOptions {
  clear?: boolean;
  forceGlobal?: boolean;
  cleanGlobals?: boolean;
}

/**
 * Walidacja zmiennych środowiskowych pod Discord REST API
 */
function assertConfig() {
  if (!config.DISCORD_TOKEN) {
    throw new Error('❌ Missing DISCORD_TOKEN in environment configuration.');
  }
  if (!config.DISCORD_CLIENT_ID) {
    throw new Error('❌ Missing DISCORD_CLIENT_ID in environment configuration.');
  }
}

/**
 * Rejestracja komend Slash w Discord API
 */
export async function deployCommands(options: DeployOptions = {}): Promise<void> {
  assertConfig();

  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
  const clientId = config.DISCORD_CLIENT_ID;
  const guildId = options.forceGlobal ? undefined : config.DISCORD_GUILD_ID;

  const isGuildDeploy = Boolean(guildId);
  const targetRoute = isGuildDeploy
    ? Routes.applicationGuildCommands(clientId, guildId!)
    : Routes.applicationCommands(clientId);

  const scopeLabel = isGuildDeploy
    ? `[GUILD: ${guildId}] (Instant propagation)`
    : '[GLOBAL] (May take up to an hour to cache across all guilds)';

  console.log('\n======================================================');
  console.log(`🚀 R3V0 SLASH COMMAND DEPLOYER`);
  console.log(`🎯 Target Scope: ${scopeLabel}`);
  console.log(`📦 Commands to Register: ${commandData.length}`);
  console.log('======================================================\n');

  // Wypisz strukturę komend w terminalu
  commandData.forEach((cmd, idx) => {
    const raw = cmd as { name: string; options?: Array<{ type: number; name: string }> };
    const subCount = raw.options?.filter(o => o.type === 1).length ?? 0;
    const subLabel = subCount > 0 ? `(${subCount} subcommands)` : '';
    console.log(`  ${(idx + 1).toString().padStart(2, ' ')}. /${raw.name.padEnd(14, ' ')} ${subLabel}`);
  });

  console.log('\n⏳ Connecting to Discord Gateway REST API...');
  const startTime = Date.now();

  try {
    // 1. Opcjonalne czyszczenie komend globalnych przy wdrażaniu na serwer lokalny
    // Eliminuje problem duplikatów: gdy na serwerze widać komendę podwójnie
    if (isGuildDeploy && options.cleanGlobals) {
      console.log('🧹 Purging lingering GLOBAL commands to prevent duplication...');
      await rest.put(Routes.applicationCommands(clientId), { body: [] });
      console.log('✅ Global command registry cleared.');
    }

    // 2. Rejestracja właściwych komend
    const result = (await rest.put(targetRoute, {
      body: commandData as RESTPostAPIApplicationCommandsJSONBody[]
    })) as unknown[];

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n🎉 SUCCESS! Successfully deployed ${result.length} commands in ${duration}s.`);
    logger.info({ count: result.length, isGuildDeploy, duration }, '[DEPLOY] Slash commands successfully synchronized');
  } catch (error: unknown) {
    console.error('\n❌ FAILED TO DEPLOY COMMANDS!');
    if (error instanceof Error) {
      console.error(`💥 Error Message: ${error.message}`);
    }
    logger.error({ error: String(error) }, '[DEPLOY] Fatal error while uploading application commands');
    throw error;
  }
}

/**
 * Całkowity reset rejestru komend Slash
 */
export async function clearCommands(options: { forceGlobal?: boolean } = {}): Promise<void> {
  assertConfig();

  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
  const clientId = config.DISCORD_CLIENT_ID;
  const guildId = options.forceGlobal ? undefined : config.DISCORD_GUILD_ID;

  const isGuild = Boolean(guildId);
  const route = isGuild
    ? Routes.applicationGuildCommands(clientId, guildId!)
    : Routes.applicationCommands(clientId);

  console.log(`\n⚠️  PURGING ALL COMMANDS on scope: ${isGuild ? `GUILD (${guildId})` : 'GLOBAL'}`);

  try {
    await rest.put(route, { body: [] });
    console.log('✅ Successfully purged all slash commands.');
    logger.info({ isGuild }, '[DEPLOY] Commands successfully wiped');
  } catch (error) {
    console.error('❌ Failed to clear slash commands:', error);
    throw error;
  }
}

// ============================================================================
// CLI RUNNER (Pozwala odpalić plik bezpośrednio: node deploy.js / npm run deploy)
// ============================================================================
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const args = process.argv.slice(2);
  const isClear = args.includes('--clear');
  const forceGlobal = args.includes('--global');
  const cleanGlobals = args.includes('--clean-globals');

  const action = isClear
    ? clearCommands({ forceGlobal })
    : deployCommands({ forceGlobal, cleanGlobals });

  action
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
