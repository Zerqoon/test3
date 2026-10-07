import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DateTime } from 'luxon';
import { z } from 'zod';

const snowflake = z.string().regex(/^\d{17,20}$/, 'Expected a Discord ID stored as a string');
export const configSchema = z.object({
  brand: z.literal('GOAT'),
  timezone: z.string().refine(s => DateTime.now().setZone(s).isValid, 'Invalid timezone'),
  channels: z.object({ usernames: snowflake, logs: snowflake, welcome: snowflake }),
  access: z.object({ staffRoleIds: z.array(snowflake).min(1), ownerUserIds: z.array(snowflake).min(1) }),
  nickname: z.object({ roleId: snowflake, suffix: z.string().min(1).max(12) }),
  usernames: z.object({ convertExistingOnStartup: z.boolean(), logLiveConversions: z.boolean(),
    maxAttachmentBytes: z.number().int().min(1024).max(250_000_000),
    maxTotalAttachmentBytes: z.number().int().min(1024).max(250_000_000) }),
  history: z.object({ autoImport: z.boolean(), includeArchivedThreads: z.boolean(),
    syncIntervalMinutes: z.number().int().min(5).max(1440),
    excludedChannelIds: z.array(snowflake), pageDelayMs: z.number().int().min(0).max(5000) }),
  logging: z.object({ logGifs: z.boolean(), retainMessageContentDays: z.number().int().min(0) }),
  giveaways: z.object({ maxDurationDays: z.number().int().min(1).max(3650), maxWinners: z.number().int().min(1).max(20) }),
  autoRegisterCommands: z.boolean()
}).superRefine((c, ctx) => {
  if (new Set(Object.values(c.channels)).size !== 3) ctx.addIssue({ code: 'custom', message: 'The three configured channels must be different.' });
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
