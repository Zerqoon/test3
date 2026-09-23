import 'dotenv/config';
import { z } from 'zod';
const bool = z.string().optional().transform(v => v?.toLowerCase() === 'true');
const schema = z.object({
  DISCORD_TOKEN: z.string().default(''),
  DISCORD_CLIENT_ID: z.string().default(''),
  DISCORD_GUILD_ID: z.string().min(1).optional(),
  MAIN_CLAN: z.string().min(1).default('R3V0'),
  DATABASE_PATH: z.string().default('./data/bot.db'),
  BIGGAMES_API_BASE: z.string().url().default('https://ps99.biggamesapi.io'),
  ROBLOX_USERS_API_BASE: z.string().url().default('https://users.roblox.com'),
  ROBLOX_THUMBNAILS_API_BASE: z.string().url().default('https://thumbnails.roblox.com'),
  LOG_LEVEL: z.string().default('info'),
  API_TIMEOUT_MS: z.coerce.number().int().min(1000).default(8000),
  API_RETRIES: z.coerce.number().int().min(0).max(8).default(3),
  TRACKER_ACTIVE_SECONDS: z.coerce.number().int().min(60).default(180),
  TRACKER_IDLE_SECONDS: z.coerce.number().int().min(120).default(900),
  TRACKER_TICK_SECONDS: z.coerce.number().int().min(30).default(60),
  AUTO_DEPLOY_COMMANDS: bool.default(true),
  MAX_WHITELIST_CLANS: z.coerce.number().int().min(1).max(100).default(25)
});
export const config = schema.parse(process.env);
