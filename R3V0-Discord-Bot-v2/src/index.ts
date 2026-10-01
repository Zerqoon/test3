import { createServer } from "node:http";
import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  ActivityType,
} from "discord.js";
import { credentials, env, config } from "./config.js";
import { Store } from "./services/store.js";
import { Logs } from "./services/logs.js";
import { registerCommands } from "./services/registration.js";
import { interactionEvents } from "./events/interactions.js";
import { messageEvents } from "./events/messages.js";
import { guildEvents } from "./events/guild.js";
import { logger } from "./utils/logger.js";
import { backup } from "./services/backup.js";
import type { Context } from "./types.js";
import { RobloxVerification } from "./services/verification.js";
import { NewAccountProtection } from "./services/protection.js";
import { VoiceManager } from "./services/voice.js";

async function main() {
  const c = credentials();
  const store = new Store(env.DATABASE_PATH);
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
    allowedMentions: { parse: [] },
  });
  const logs = new Logs(client, store);
  const core = { client, store, logs, startedAt: Date.now() };
  const ctx: Context = {
    ...core,
    verification: new RobloxVerification(core),
    protection: new NewAccountProtection(core),
    voice: new VoiceManager(core),
  };
  let initialized = false;
  let stopping = false;
  let disconnectedAt: number | undefined;
  const timers: NodeJS.Timeout[] = [];
  const health = createServer((req, res) => {
    if (req.url !== "/health" && req.url !== "/health/live") {
      res.writeHead(404);
      res.end();
      return;
    }
    const ready = initialized && client.isReady() && !stopping;
    res.writeHead(req.url === "/health/live" || ready ? 200 : 503, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(
      JSON.stringify({
        status: ready ? "ready" : "starting",
        uptime: Math.floor(process.uptime()),
      }),
    );
  });
  health.listen(env.PORT, "0.0.0.0");
  async function stop(exitCode = 0) {
    if (stopping) return;
    stopping = true;
    initialized = false;
    for (const timer of timers) clearInterval(timer);
    // Every economy operation commits before its Discord response; unsent logs remain in SQLite.
    logs.stop();
    ctx.voice.stop();
    await client.destroy();
    await new Promise<void>((resolve) => health.close(() => resolve()));
    if (store.db.open) {
      store.db.pragma("wal_checkpoint(TRUNCATE)");
      store.close();
    }
    process.exit(exitCode);
  }
  process.once("SIGTERM", () => {
    void stop();
  });
  process.once("SIGINT", () => {
    void stop();
  });
  process.on("unhandledRejection", (err) => {
    logger.fatal({ err }, "Nieobsłużony błąd asynchroniczny");
    void stop(1);
  });
  client.on(Events.Error, (err) =>
    logger.error({ err }, "Błąd klienta Discord"),
  );
  client.on(Events.Warn, (message) =>
    logger.warn({ message }, "Ostrzeżenie Discord"),
  );
  client.on(Events.ShardDisconnect, () => {
    disconnectedAt ??= Date.now();
    ctx.voice.resetSessions();
  });
  client.on(Events.ShardResume, () => {
    disconnectedAt = undefined;
  });
  interactionEvents(ctx);
  messageEvents(ctx);
  guildEvents(ctx);
  ctx.voice.attach();
  client.once(Events.ClientReady, async (ready) => {
    try {
      const guild = await client.guilds.fetch(c.DISCORD_GUILD_ID);
      await guild.roles.fetch();
      if (env.AUTO_REGISTER_COMMANDS === "true") await registerCommands(store);
      ready.user.setPresence({
        activities: [
          {
            name: `/pomoc • ${config.brand.name}`,
            type: ActivityType.Watching,
          },
        ],
        status: "online",
      });
      initialized = true;
      logs.start();
      store.cleanup();
      void ctx.voice
        .start(guild)
        .catch((err) =>
          logger.warn({ err }, "Nie udało się uruchomić obsługi voice"),
        );
      void (async () => {
        // Optional integrations cannot prevent health checks or core command registration.
        if (config.protection.enabled)
          await ctx.protection
            .setup(guild)
            .catch((err) =>
              logger.warn(
                { err },
                "Uruchom /setup, aby naprawić ochronę kanałów",
              ),
            );
        await ctx.verification
          .setup(guild)
          .catch((err) =>
            logger.warn({ err }, "Panel weryfikacji wymaga /setup-weryfikacja"),
          );
        if (config.temporaryVoice.enabled)
          await ctx.voice
            .setup(guild)
            .catch((err) =>
              logger.warn({ err }, "Panel voice wymaga /setup-voice"),
            );
      })();
      timers.push(
        setInterval(() => {
          if (client.isReady())
            void ctx.protection
              .sweep(guild)
              .catch((err) => logger.warn({ err }, "Przegląd kwarantanny"));
        }, 60000),
      );
      const scheduledBackup = async () => {
        const last = Number(store.setting("last-backup") ?? 0);
        if (Date.now() - last < 86400000) return;
        const file = await backup(store);
        if (file && store.db.open)
          store.setSetting("last-backup", String(Date.now()));
      };
      void scheduledBackup().catch((err) =>
        logger.warn({ err }, "Błąd automatycznej kopii bazy"),
      );
      timers.push(
        setInterval(() => {
          try {
            store.cleanup();
          } catch (err) {
            logger.error({ err }, "Błąd retencji danych");
          }
        }, 3600000),
      );
      timers.push(
        setInterval(() => {
          void scheduledBackup().catch((err) =>
            logger.warn({ err }, "Błąd automatycznej kopii bazy"),
          );
        }, 3600000),
      );
      timers.push(
        setInterval(() => {
          if (client.isReady()) disconnectedAt = undefined;
          else disconnectedAt ??= Date.now();
          if (disconnectedAt && Date.now() - disconnectedAt > 300000) {
            logger.error("Brak połączenia Discord przez 5 minut; restart");
            void stop(1);
          }
        }, 30000),
      );
      logger.info({ bot: ready.user.tag, guildId: guild.id }, "Bot gotowy");
      // Reconcile who is currently in the guild. Do not grant roles to everyone at startup.
      void guild.members
        .fetch()
        .then(async (members) => {
          store.db.transaction(() => {
            store.db
              .prepare("UPDATE profiles SET active=0 WHERE guild_id=?")
              .run(guild.id);
            for (const m of members.values())
              if (!m.user.bot)
                store.member(guild.id, m.id, true, m.displayName);
          })();
          for (const member of members.values()) {
            if (stopping) return;
            if (member.user.bot) continue;
            await ctx.protection
              .apply(member)
              .catch((err) =>
                logger.warn(
                  { err, userId: member.id },
                  "Ochrona nowego konta wymaga sprawdzenia",
                ),
              );
          }
        })
        .catch((err) =>
          logger.warn({ err }, "Nie udało się odświeżyć listy członków"),
        );
    } catch (err) {
      logger.fatal({ err }, "Błąd uruchomienia");
      await stop(1);
    }
  });
  try {
    await client.login(c.DISCORD_TOKEN);
  } catch (err) {
    logger.fatal(
      { err },
      "Nie udało się zalogować bota. Sprawdź token i privileged intents.",
    );
    await stop(1);
  }
}
void main().catch((err) => {
  logger.fatal({ err }, "Nie udało się uruchomić aplikacji");
  process.exitCode = 1;
});
