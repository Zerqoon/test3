import { createHash } from "node:crypto";
import { REST, Routes } from "discord.js";
import { credentials } from "../config.js";
import { commandData } from "../commands/definitions.js";
import type { Store } from "./store.js";
import { logger } from "../utils/logger.js";
export async function registerCommands(store?: Store, force = false) {
  const c = credentials();
  const hash = createHash("sha256")
    .update(JSON.stringify(commandData))
    .digest("hex");
  const key = `commands:${c.DISCORD_CLIENT_ID}:${c.DISCORD_GUILD_ID}`;
  if (!force && store?.setting(key) === hash) return;
  const rest = new REST({ version: "10", timeout: 20000, retries: 3 }).setToken(
    c.DISCORD_TOKEN,
  );
  await rest.put(
    Routes.applicationGuildCommands(c.DISCORD_CLIENT_ID, c.DISCORD_GUILD_ID),
    { body: commandData },
  );
  store?.setSetting(key, hash);
  logger.info({ count: commandData.length }, "Zarejestrowano komendy slash");
}
