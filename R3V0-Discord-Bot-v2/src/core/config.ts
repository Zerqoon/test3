import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { defaultGifDomains } from './media.js';

const snowflake = z.string().regex(/^\d{17,20}$/, 'Expected a Discord ID stored as a string');
export const configSchema = z.object({
  brand: z.literal('GOAT'),
  timezone: z.string().refine(s => DateTime.now().setZone(s).isValid, 'Invalid timezone'),
  channels: z.object({ usernames: snowflake, logs: snowflake, welcome: snowflake,
    messageLogs: snowflake.default('1557439487813091358'), memberLogs: snowflake.default('1557439665378959491') }),
  access: z.object({ staffRoleIds: z.array(snowflake).min(1), ownerUserIds: z.array(snowflake).min(1) }),
  nickname: z.object({ roleId: snowflake, suffix: z.string().min(1).max(12) }),
  usernames: z.object({ convertExistingOnStartup: z.boolean(), logLiveConversions: z.boolean(),
    maxAttachmentBytes: z.number().int().min(1024).max(250_000_000),
    maxTotalAttachmentBytes: z.number().int().min(1024).max(250_000_000) }),
  history: z.object({ autoImport: z.boolean(), includeArchivedThreads: z.boolean(),
    syncIntervalMinutes: z.number().int().min(5).max(1440),
    excludedChannelIds: z.array(snowflake), pageDelayMs: z.number().int().min(0).max(5000) }),
  logging: z.object({ logGifs: z.boolean(), retainMessageContentDays: z.number().int().min(0),
    batchWindowMs: z.number().int().min(0).max(60000).default(700),
    batchMaxEmbeds: z.number().int().min(1).max(10).default(5),
    ignoreRoutineBotActions: z.boolean().default(true), logSystemOnline: z.boolean().default(false) }),
  linkFilter: z.object({ enabled: z.boolean().default(true),
    blockInvites: z.boolean().default(true),
    allowedDomains: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).default([
      'giphy.com', 'gph.is', 'tenor.com', 'klipy.com', 'tiktok.com', 'youtube.com', 'youtu.be', 'roblox.com'
    ]),
    gifAllowedRoleIds: z.array(snowflake).default([]),
    allowApprovedGifs: z.boolean().default(true),
    gifProviderDomains: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).min(1).default(defaultGifDomains),
    unrestrictedGifChannelIds: z.array(snowflake).default(['1557577086351179866']),
    notifications: z.object({ enabled: z.boolean().default(true), deleteAfterSeconds: z.number().int().min(1).max(60).default(10),
      cooldownSeconds: z.number().int().min(1).max(60).default(10), maxDelaySeconds: z.number().int().min(10).max(300).default(60) }).default({})
  }).default({}),
  giveaways: z.object({ maxDurationDays: z.number().int().min(1).max(3650), maxWinners: z.number().int().min(1).max(20),
    defaultRoleId: snowflake.default('718165098526670948') }),
  autorole: z.object({ enabled: z.boolean(), roleId: snowflake, syncExistingOnStartup: z.boolean() })
    .default({ enabled: true, roleId: '1552638283748737094', syncExistingOnStartup: true }),
  usernameReminder: z.object({ enabled: z.boolean(), roleId: snowflake, deleteAfterSeconds: z.number().int().min(10).max(3600) })
    .default({ enabled: true, roleId: '718165098526670948', deleteAfterSeconds: 60 }),
  roleUsernameDm: z.object({ enabled: z.boolean().default(true), roleId: snowflake.default('1552474081054564402') }).default({}),
  tickets: z.object({ enabled: z.boolean().default(true), panelChannelId: snowflake.default('1557384522713276488'),
    logChannelId: snowflake.default('1557439533979803678'), categoryId: snowflake.nullable().default(null),
    maxParticipants: z.number().int().min(1).max(50).default(20),
    cooldownSeconds: z.number().int().min(0).max(86400).default(300),
    maxTicketsPerHour: z.number().int().min(1).max(20).default(3),
    maxOpenTickets: z.number().int().min(1).max(200).default(50),
    voting: z.object({ enabled: z.boolean().default(true), channelId: snowflake.default('1557433699572777000'),
      durationSeconds: z.number().int().min(60).max(604800).default(180),
      minimumVotes: z.number().int().min(1).max(1000).default(3), voterRoleIds: z.array(snowflake).default([]) }).default({})
  }).default({}),
  autoRegisterCommands: z.boolean()
}).superRefine((c, ctx) => {
  if (new Set(Object.values(c.channels)).size !== Object.values(c.channels).length) ctx.addIssue({ code: 'custom', message: 'The configured log, username and welcome channels must be different.' });
});

export type Config = z.infer<typeof configSchema>;
export const config = configSchema.parse(JSON.parse(readFileSync(resolve('config.json'), 'utf8')));

export function resolveDatabasePath(variables: NodeJS.ProcessEnv = process.env): string {
  const explicitPath = variables.DATABASE_PATH?.trim();
  const volumePath = variables.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  return resolve(explicitPath || (volumePath ? join(volumePath, 'goat.sqlite') : './data/goat.sqlite'));
}

export function assertPersistentDatabase(variables: NodeJS.ProcessEnv = process.env): void {
  if (!variables.RAILWAY_ENVIRONMENT_ID?.trim()) return;
  const volumePath = variables.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (!volumePath) {
    throw new Error('GOAT: attach a Railway volume at /app/data before deploying. Statistics and giveaways require persistent storage.');
  }
  const location = relative(resolve(volumePath), resolveDatabasePath(variables));
  if (!location || location === '..' || location.startsWith(`..${sep}`) || isAbsolute(location)) {
    throw new Error('GOAT: DATABASE_PATH must point to a file inside the attached Railway volume. Use /app/data/goat.sqlite with a volume mounted at /app/data.');
  }
}

export const env = {
  token: process.env.DISCORD_TOKEN?.trim() ?? '',
  guildId: process.env.GUILD_ID?.trim() ?? '',
  applicationId: process.env.APPLICATION_ID?.trim() ?? '',
  databasePath: resolveDatabasePath(),
  logLevel: process.env.LOG_LEVEL ?? 'info'
};
export function requireToken(): void {
  if (!env.token || env.token === 'PASTE_YOUR_BOT_TOKEN_HERE') {
    throw new Error('GOAT: set DISCORD_TOKEN in Railway Variables or your local .env file. Keep the token private.');
  }
}
