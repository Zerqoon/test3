import { REST, Routes } from 'discord.js';
import { env, requireToken } from '../src/core/config.js';
import { commandDefinitions } from '../src/commands/definitions.js';
requireToken();
if (!env.guildId || !env.applicationId) throw new Error('For manual registration, set GUILD_ID and APPLICATION_ID in .env. Normal startup detects both automatically.');
await new REST({ version: '10' }).setToken(env.token).put(Routes.applicationGuildCommands(env.applicationId, env.guildId), { body: commandDefinitions.map(c => c.toJSON()) });
console.log('GOAT guild commands registered.');
