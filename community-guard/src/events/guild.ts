import {
  AuditLogEvent,
  Events,
  PermissionFlagsBits,
  type Guild,
} from "discord.js";
import { config, env } from "../config.js";
import type { Context } from "../types.js";
import { giveCommunity, syncLevelRoles } from "../services/roles.js";
import { embed } from "../utils/embeds.js";
import { clean, stamp } from "../utils/format.js";
import { logger } from "../utils/logger.js";

const isGuild = (g: Guild) => g.id === env.DISCORD_GUILD_ID;
const lacksAudit = (g: Guild) =>
  !g.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog);
function value(input: unknown): string {
  if (input === undefined || input === null) return "—";
  if (typeof input === "string") return clean(input, 250);
  if (typeof input === "object") return clean(JSON.stringify(input), 350);
  return String(input).slice(0, 350);
}
export function guildEvents(ctx: Context) {
  ctx.client.on(Events.GuildMemberAdd, async (member) => {
    if (!isGuild(member.guild)) return;
    try {
      if (!member.user.bot)
        ctx.store.member(member.guild.id, member.id, true, member.displayName);
      try {
        if (!member.pending) {
          await giveCommunity(member);
          if (!member.user.bot) await syncLevelRoles(member, ctx.store);
        }
      } catch (err) {
        logger.warn({ err }, "Nie udało się nadać automatycznych ról");
      }
      const age = Date.now() - member.user.createdTimestamp;
      ctx.logs.general(
        embed(
          "Nowy członek dołączył",
          `<@${member.id}> • **${clean(member.user.tag, 80)}**\nID: ${member.id}\nCzłonkowie: **${member.guild.memberCount}**`,
          "#6EE7B7",
        )
          .setThumbnail(member.user.displayAvatarURL())
          .addFields(
            {
              name: "Konto utworzone",
              value: stamp(member.user.createdTimestamp, "F"),
            },
            {
              name: "Dołączono",
              value: stamp(member.joinedTimestamp ?? Date.now(), "F"),
            },
            {
              name: "Informacja",
              value: `${age < 7 * 86400000 ? "🟠 Konto młodsze niż 7 dni." : "Konto starsze niż 7 dni."}${member.pending ? "\nOczekuje na ukończenie Membership Screening." : ""}`,
            },
          ),
      );
    } catch (err) {
      logger.error({ err }, "Błąd dołączenia członka");
    }
  });
  ctx.client.on(Events.GuildMemberRemove, (member) => {
    if (!isGuild(member.guild)) return;
    try {
      if (!member.user.bot) ctx.store.member(member.guild.id, member.id, false);
      ctx.logs.general(
        embed(
          "Członek opuścił serwer",
          `<@${member.id}> • **${clean(member.user.tag, 80)}**\nID: ${member.id}\nCzłonkowie: **${member.guild.memberCount}**\nPoziom i saldo zachowano na wypadek powrotu.`,
          "#FB7185",
        ).setThumbnail(member.user.displayAvatarURL()),
      );
    } catch (err) {
      logger.error({ err }, "Błąd opuszczenia serwera");
    }
  });
  ctx.client.on(Events.GuildAuditLogEntryCreate, (entry, guild) => {
    if (!isGuild(guild)) return;
    try {
      const action = AuditLogEvent[entry.action] ?? `Akcja ${entry.action}`;
      const fields =
        entry.changes
          ?.filter((c) => !/token|secret|password/i.test(c.key))
          .slice(0, 4)
          .map((c) => ({
            name: c.key.slice(0, 100),
            value: `**Przed:** ${value(c.old)}\n**Po:** ${value(c.new)}`.slice(
              0,
              650,
            ),
          })) ?? [];
      const e = embed(
        `Dziennik zmian • ${action}`,
        `**Wykonał:** ${entry.executorId ? `<@${entry.executorId}> (${entry.executorId})` : "System / nieznany"}\n**Cel:** ${entry.targetId ?? "—"}\n**Powód:** ${clean(entry.reason ?? "Nie podano", 600)}\n**Wpis audytu:** ${entry.id}\n**Czas:** ${stamp(entry.createdTimestamp, "F")}`,
      );
      if (entry.executor) e.setThumbnail(entry.executor.displayAvatarURL());
      if (fields.length) e.addFields(fields);
      if (entry.action === AuditLogEvent.MemberRoleUpdate) {
        const roleChange = (key: string) =>
          (
            entry.changes.find((c) => c.key === key)?.new as
              { id: string; name: string }[] | undefined
          )
            ?.map((r) => `<@&${r.id}>`)
            .join(" ") || "—";
        e.addFields(
          { name: "Dodano role", value: roleChange("$add").slice(0, 950) },
          { name: "Usunięto role", value: roleChange("$remove").slice(0, 950) },
        );
      }
      ctx.logs.audit(e);
    } catch (err) {
      logger.error({ err }, "Błąd logowania audytu Discord");
    }
  });
  ctx.client.on(Events.GuildMemberUpdate, async (before, after) => {
    if (!isGuild(after.guild)) return;
    try {
      if (before.pending && !after.pending) {
        await giveCommunity(after);
        if (!after.user.bot) await syncLevelRoles(after, ctx.store);
      }
      if (!after.user.bot)
        ctx.store.profile(after.guild.id, after.id, after.displayName);
      if (!lacksAudit(after.guild)) return;
      const added = after.roles.cache
        .filter((r) => !before.roles.cache.has(r.id))
        .map((r) => `<@&${r.id}>`);
      const removed = before.roles.cache
        .filter((r) => !after.roles.cache.has(r.id))
        .map((r) => `<@&${r.id}>`);
      if (
        !added.length &&
        !removed.length &&
        before.nickname === after.nickname &&
        before.communicationDisabledUntilTimestamp ===
          after.communicationDisabledUntilTimestamp
      )
        return;
      ctx.logs.audit(
        embed(
          "Zmiana członka • obserwacja",
          `<@${after.id}>\n**Dodano:** ${added.join(" ") || "—"}\n**Usunięto:** ${removed.join(" ") || "—"}\n**Pseudonim:** ${clean(before.nickname ?? before.user.username, 100)} → ${clean(after.nickname ?? after.user.username, 100)}\nBrak View Audit Log: sprawca nie jest dostępny.`,
        ),
      );
    } catch (err) {
      logger.warn({ err }, "Błąd aktualizacji członka");
    }
  });
  ctx.client.on(Events.UserUpdate, (before, after) => {
    const guild = ctx.client.guilds.cache.get(env.DISCORD_GUILD_ID!);
    if (!guild?.members.cache.has(after.id)) return;
    if (
      before.username === after.username &&
      before.avatar === after.avatar &&
      before.globalName === after.globalName
    )
      return;
    try {
      ctx.logs.audit(
        embed(
          "Zmiana profilu Discord",
          `<@${after.id}>\n**Nazwa:** ${clean(before.username ?? "—", 100)} → ${clean(after.username, 100)}\n**Wyświetlana:** ${clean(before.globalName ?? "—", 100)} → ${clean(after.globalName ?? "—", 100)}\n**Avatar:** ${before.avatar !== after.avatar ? "Zmieniono" : "Bez zmiany"}`,
        ).setThumbnail(after.displayAvatarURL()),
      );
    } catch (err) {
      logger.warn({ err }, "Błąd aktualizacji profilu");
    }
  });
  for (const event of [
    Events.GuildRoleCreate,
    Events.GuildRoleDelete,
  ] as const) {
    ctx.client.on(event, (role) => {
      if (isGuild(role.guild) && lacksAudit(role.guild))
        ctx.logs.audit(
          embed(
            `Rola • ${event}`,
            `${clean(role.name)} (${role.id})\nBrak View Audit Log: sprawca nie jest dostępny.`,
          ),
        );
    });
  }
  ctx.client.on(Events.GuildRoleUpdate, (before, after) => {
    if (isGuild(after.guild) && lacksAudit(after.guild))
      ctx.logs.audit(
        embed(
          "Rola zmieniona • obserwacja",
          `${clean(before.name)} → ${clean(after.name)}\nID: ${after.id}\nUprawnienia: ${before.permissions.bitfield} → ${after.permissions.bitfield}`,
        ),
      );
  });
  ctx.client.on(Events.VoiceStateUpdate, (before, after) => {
    if (!isGuild(after.guild) || before.channelId === after.channelId) return;
    ctx.logs.audit(
      embed(
        "Kanał głosowy • zmiana",
        `<@${after.id}>\n**Z:** ${before.channelId ? `<#${before.channelId}>` : "Poza kanałem"}\n**Do:** ${after.channelId ? `<#${after.channelId}>` : "Poza kanałem"}`,
      ),
    );
  });
}
