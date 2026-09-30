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
  .max(20)
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
