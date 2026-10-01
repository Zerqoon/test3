import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const id = z.string().regex(/^\d{17,20}$/);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const positive = z.number().int().positive();
const schema = z
  .object({
    brand: z.object({
      name: z.string().min(1).max(60),
      accent: color,
      currency: z.string().min(1).max(40),
      footer: z.string().max(100),
    }),
    roles: z.object({
      owner: id,
      moderator: id,
      community: id,
      booster: id.default("1555034475447062548"),
      quarantine: id.default("1555035240215351366"),
      levels: z
        .array(
          z.object({ level: positive.max(100), id, label: z.string().max(60) }),
        )
        .min(1),
    }),
    channels: z.object({
      levels: id,
      generalLogs: id,
      auditLogs: id,
      commands: id,
      verification: id.default("1549342942861459606"),
      voiceCreate: id.default("1555036112148365393"),
      voiceCategory: id.default("1555036190527197226"),
    }),
    leveling: z.object({
      enabled: z.boolean(),
      minXp: positive,
      maxXp: positive,
      cooldownSeconds: positive,
      minCharacters: positive,
      dailyCap: positive,
      curveQuadratic: positive,
      curveLinear: z.number().int().nonnegative(),
      maxLevel: positive.max(100),
      ignoredChannels: z.array(id),
      duplicateWindowSeconds: positive,
      boosterMultiplier: z.number().min(1).max(5).default(1.5),
      voice: z
        .object({
          enabled: z.boolean().default(true),
          minXp: positive.default(4),
          maxXp: positive.default(8),
          intervalSeconds: positive.min(60).default(60),
          minimumMembers: positive.min(2).default(2),
          ignoredChannels: z.array(id).default([]),
        })
        .default({
          enabled: true,
          minXp: 4,
          maxXp: 8,
          intervalSeconds: 60,
          minimumMembers: 2,
          ignoredChannels: [],
        }),
    }),
    economy: z.object({
      workMin: positive,
      workMax: positive,
      workCooldownMinutes: positive,
      dailyBase: positive,
      dailyStreakBonus: z.number().int().nonnegative(),
      dailyMaxStreak: positive,
      transferTaxPercent: z.number().int().min(0).max(30),
      maxBalance: positive.max(1e12),
    }),
    moderation: z.object({
      commandChannelOnly: z.boolean(),
      deleteChatInCommandChannel: z.boolean(),
      mediaGuard: z.boolean(),
      maxPurge: positive.max(100),
      maxTimeoutMinutes: positive.max(40320),
      warnings: z
        .object({
          expiryDays: positive.default(30),
          autoWarningCooldownSeconds: positive.default(60),
          thresholds: z
            .array(
              z.object({
                points: positive,
                timeoutMinutes: positive.max(40320),
              }),
            )
            .max(10)
            .default([
              { points: 3, timeoutMinutes: 30 },
              { points: 5, timeoutMinutes: 360 },
              { points: 7, timeoutMinutes: 1440 },
            ]),
        })
        .default({
          expiryDays: 30,
          autoWarningCooldownSeconds: 60,
          thresholds: [
            { points: 3, timeoutMinutes: 30 },
            { points: 5, timeoutMinutes: 360 },
            { points: 7, timeoutMinutes: 1440 },
          ],
        }),
      antiLink: z
        .object({
          enabled: z.boolean().default(true),
          invitePoints: positive.default(2),
          blockedDomains: z
            .array(z.string().min(3))
            .default([
              "discord.gg",
              "discord.me",
              "discord.io",
              "discord.link",
              "disboard.org",
              "discordservers.com",
            ]),
          blockShorteners: z.boolean().default(true),
          allowedDomains: z
            .array(z.string().min(3))
            .default([
              "roblox.com",
              "create.roblox.com",
              "youtube.com",
              "youtu.be",
              "wikipedia.org",
              "github.com",
            ]),
          strictExternalLinks: z.boolean().default(true),
          strictGifSafety: z.boolean().default(true),
        })
        .default({
          enabled: true,
          invitePoints: 2,
          blockedDomains: [
            "discord.gg",
            "discord.me",
            "discord.io",
            "discord.link",
            "disboard.org",
            "discordservers.com",
          ],
          blockShorteners: true,
          allowedDomains: [
            "roblox.com",
            "create.roblox.com",
            "youtube.com",
            "youtu.be",
            "wikipedia.org",
            "github.com",
          ],
          strictExternalLinks: true,
          strictGifSafety: true,
        }),
    }),
    protection: z
      .object({
        enabled: z.boolean().default(true),
        newAccountHours: positive.max(720).default(72),
        quarantineHours: positive.max(672).default(72),
      })
      .default({ enabled: true, newAccountHours: 72, quarantineHours: 72 }),
    verification: z
      .object({
        challengeMinutes: positive.max(60).default(15),
        minRobloxAgeDays: z.number().int().nonnegative().max(365).default(3),
      })
      .default({ challengeMinutes: 15, minRobloxAgeDays: 3 }),
    temporaryVoice: z
      .object({
        enabled: z.boolean().default(true),
        defaultLimit: positive.max(99).default(5),
        maxChannels: positive.max(100).default(30),
        creationCooldownSeconds: positive.default(60),
      })
      .default({
        enabled: true,
        defaultLimit: 5,
        maxChannels: 30,
        creationCooldownSeconds: 60,
      }),
    retention: z.object({
      messageDays: positive,
      maxMessages: positive.max(500000),
      logDays: positive,
      backupCount: positive.max(30),
    }),
    panels: z.object({
      rulesTitle: z.string().max(100),
      rules: z.array(z.string().min(1).max(350)).min(1).max(10),
      infoTitle: z.string().max(100),
      infoDescription: z.string().max(1500),
      customInfo: z.string().max(800),
      rulesVersion: z.string().max(30),
      rulesBanner: z.string().default("./assets/rules-banner.png"),
    }),
  })
  .superRefine((c, ctx) => {
    if (
      c.leveling.minXp > c.leveling.maxXp ||
      c.economy.workMin > c.economy.workMax
    )
      ctx.addIssue({
        code: "custom",
        message: "Min musi być mniejsze lub równe max.",
      });
    const protectedRoles = [
      c.roles.owner,
      c.roles.moderator,
      c.roles.community,
      c.roles.booster,
      c.roles.quarantine,
      ...c.roles.levels.map((r) => r.id),
    ];
    if (new Set(protectedRoles).size !== protectedRoles.length)
      ctx.addIssue({ code: "custom", message: "ID ról muszą być różne." });
    if (
      new Set(c.roles.levels.map((r) => r.level)).size !== c.roles.levels.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Progi poziomów nie mogą się powtarzać.",
      });
    if (c.leveling.voice.minXp > c.leveling.voice.maxXp)
      ctx.addIssue({
        code: "custom",
        message: "Voice minXp musi być mniejsze lub równe maxXp.",
      });
  });

export const env = z
  .object({
    DISCORD_TOKEN: z.string().optional(),
    DISCORD_CLIENT_ID: z.string().optional(),
    DISCORD_GUILD_ID: z.string().optional(),
    DATABASE_PATH: z.string().default("./data/community.sqlite"),
    CONFIG_PATH: z.string().default("./config/server.json"),
    NODE_ENV: z.string().default("production"),
    LOG_LEVEL: z
      .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
      .default("info"),
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    AUTO_REGISTER_COMMANDS: z.enum(["true", "false"]).default("true"),
    GIPHY_API_KEY: z.string().optional(),
  })
  .parse(process.env);

export const config = schema.parse(
  JSON.parse(readFileSync(resolve(env.CONFIG_PATH), "utf8")),
);
config.roles.levels.sort((a, b) => a.level - b.level);
if (config.roles.levels.some((r) => r.level > config.leveling.maxLevel))
  throw new Error("Próg roli przekracza maxLevel.");

const shopItem = z.discriminatedUnion("kind", [
  z.object({
    id: z.string().regex(/^[a-z0-9_-]+$/),
    name: z.string().max(80),
    description: z.string().max(200),
    price: positive.max(1e9),
    kind: z.literal("xp_boost"),
    multiplier: z.union([
      z.literal(1.5),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
    ]),
    minutes: positive.max(1440),
  }),
  z.object({
    id: z.string().regex(/^[a-z0-9_-]+$/),
    name: z.string().max(80),
    description: z.string().max(200),
    price: positive.max(1e9),
    kind: z.literal("title"),
    label: z.string().max(30),
    color,
  }),
  z.object({
    id: z.string().regex(/^[a-z0-9_-]+$/),
    name: z.string().max(80),
    description: z.string().max(200),
    price: positive.max(1e9),
    kind: z.literal("work_boost"),
    hours: positive.max(48),
  }),
]);
export type ShopItem = z.infer<typeof shopItem>;
export const shop = z
  .array(shopItem)
  .max(50)
  .parse(JSON.parse(readFileSync(resolve("config/shop.json"), "utf8")));
if (new Set(shop.map((i) => i.id)).size !== shop.length)
  throw new Error("ID produktów muszą być unikalne.");
export function credentials() {
  const checked = z
    .object({
      DISCORD_TOKEN: z
        .string()
        .min(30)
        .refine((s) => !s.includes("WPISZ")),
      DISCORD_CLIENT_ID: id,
      DISCORD_GUILD_ID: id,
    })
    .safeParse(env);
  if (!checked.success)
    throw new Error(
      "Uzupełnij DISCORD_TOKEN, DISCORD_CLIENT_ID i DISCORD_GUILD_ID w .env albo Railway Variables.",
    );
  return checked.data;
}
