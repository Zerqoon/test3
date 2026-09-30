import {
  AttachmentBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { Context } from "../types.js";
import { config } from "../config.js";
import { number, clean, stamp, duration, dayKey } from "../utils/format.js";
import { embed } from "../utils/embeds.js";
import { assert } from "../utils/errors.js";
import { renderCard } from "../canvas/cards.js";
import { levelForXp, progressForXp } from "../services/levels.js";
import { rulesPanel } from "./panels.js";

export async function general(i: ChatInputCommandInteraction, ctx: Context) {
  const name = i.commandName;
  const guild = i.guild!;
  if (name === "ping") {
    await i.editReply({
      embeds: [
        embed(
          "Bot działa",
          `Gateway: **${ctx.client.ws.ping} ms**\nObsługa komendy: **${Date.now() - i.createdTimestamp} ms**`,
        ),
      ],
    });
    return;
  }
  if (name === "pomoc") {
    await i.editReply({
      embeds: [
        embed(
          "Centrum pomocy",
          `Komendy dla użytkowników działają w <#${config.channels.commands}>. Owner i Moderator mogą używać ich wszędzie.`,
        ).addFields(
          {
            name: "Społeczność",
            value:
              "`/info serwer` `/info osoba` `/info bot`\n`/regulamin` `/ping`",
          },
          {
            name: "Poziomy",
            value:
              "`/poziom` `/profil` `/ranking typ:xp`\nXP za aktywność, kumulacyjne role i karty Canvas.",
          },
          {
            name: "Ekonomia",
            value:
              "`/ekonomia saldo` `/ekonomia praca` `/ekonomia daily`\n`/ekonomia przelew` `/ekonomia sklep` `/ekonomia kup`\n`/ekonomia ekwipunek` `/ekonomia uzyj` `/ekonomia historia`",
          },
          {
            name: "Moderator / Owner",
            value:
              "`/moderacja warn | sprawy | unwarn | timeout | untimeout`\n`/moderacja kick | ban | unban | clear | nick | rola`\n`/moderacja slowmode | lock | unlock`\n`/ogloszenie` — formularz i podgląd",
          },
          {
            name: "Owner",
            value:
              "`/admin diagnostyka | publikuj | synchronizacja`\n`/admin poziom | waluta | backup`",
          },
        ),
      ],
    });
    return;
  }
  if (name === "regulamin") {
    await i.editReply(rulesPanel());
    return;
  }
  if (name === "ranking") {
    const type = i.options.getString("typ", true) as "xp" | "balance";
    const rows = ctx.store.top(guild.id, type);
    await i.editReply({
      embeds: [
        embed(
          type === "xp"
            ? "Ranking aktywności • TOP 10"
            : "Ranking ekonomii • TOP 10",
          rows
            .map(
              (r, index) =>
                `${["🥇", "🥈", "🥉"][index] ?? `**${index + 1}.**`} <@${r.user_id}> — **${number(r[type])} ${type === "xp" ? "XP" : config.brand.currency}**${type === "xp" ? ` • Poziom ${levelForXp(r.xp)}` : ""}`,
            )
            .join("\n\n") || "Ranking czeka na pierwszą aktywność.",
        ),
      ],
    });
    return;
  }
  if (name === "poziom" || name === "profil") {
    const user = i.options.getUser("osoba") ?? i.user;
    assert(!user.bot, "Boty nie zdobywają XP.");
    const member = await guild.members.fetch(user.id);
    const p = ctx.store.profile(guild.id, user.id, member.displayName);
    const profile = {
      ...p,
      day_xp: p.xp_day === dayKey(Date.now()) ? p.day_xp : 0,
    };
    const rank = ctx.store.rank(guild.id, user.id);
    try {
      const png = await renderCard({
        kind: "rank",
        profile,
        rank,
        avatarUrl: user.displayAvatarURL({ extension: "png", size: 256 }),
      });
      await i.editReply({
        files: [new AttachmentBuilder(png, { name: "profil.png" })],
      });
    } catch {
      const pr = progressForXp(p.xp);
      await i.editReply({
        embeds: [
          embed(
            `Profil • ${clean(member.displayName, 80)}`,
            `Poziom **${pr.level}** • ${number(p.xp)} XP\nRanking: **#${rank}**\nSaldo: **${number(p.balance)} ${config.brand.currency}**`,
          ),
        ],
      });
    }
    return;
  }
  if (name === "info") {
    const sub = i.options.getSubcommand();
    if (sub === "bot") {
      await i.editReply({
        embeds: [
          embed(
            "Community Guard • Status",
            `Czas działania: **${duration(Date.now() - ctx.startedAt)}**\nGateway: **${ctx.client.ws.ping} ms**\nPamięć RSS: **${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB**\nWersja: **1.0.0**\n\n✅ Administracja i kontrola ról\n✅ Dwa kanały logów i trwała kolejka\n✅ Trudne poziomy oraz Canvas\n✅ Ekonomia, sklep i historia\n✅ SQLite i kopie zapasowe`,
          ),
        ],
      });
    } else if (sub === "serwer") {
      const e = embed(
        guild.name,
        guild.description ?? "Informacje o społeczności",
      ).addFields(
        { name: "Owner serwera", value: `<@${guild.ownerId}>`, inline: true },
        { name: "Członkowie", value: number(guild.memberCount), inline: true },
        {
          name: "Utworzono",
          value: stamp(guild.createdTimestamp, "D"),
          inline: true,
        },
        {
          name: "Role / kanały",
          value: `${guild.roles.cache.size} / ${guild.channels.cache.size}`,
          inline: true,
        },
        {
          name: "Boosty",
          value: `${guild.premiumSubscriptionCount ?? 0} • Tier ${guild.premiumTier}`,
          inline: true,
        },
        { name: "ID serwera", value: guild.id, inline: true },
      );
      if (guild.iconURL()) e.setThumbnail(guild.iconURL()!);
      await i.editReply({ embeds: [e] });
    } else {
      const user = i.options.getUser("osoba", true);
      const member = await guild.members.fetch(user.id);
      const p = ctx.store.profile(guild.id, user.id, member.displayName);
      const roles = member.roles.cache
        .filter((r) => r.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .map((r) => `<@&${r.id}>`)
        .join(" ");
      await i.editReply({
        embeds: [
          embed(`Osoba • ${clean(member.displayName, 80)}`)
            .setThumbnail(user.displayAvatarURL())
            .addFields(
              { name: "Konto", value: `${clean(user.tag)}\nID: ${user.id}` },
              {
                name: "Utworzono konto",
                value: stamp(user.createdTimestamp, "F"),
                inline: true,
              },
              {
                name: "Dołączono",
                value: member.joinedTimestamp
                  ? stamp(member.joinedTimestamp, "F")
                  : "Brak danych",
                inline: true,
              },
              {
                name: "Aktywność",
                value: `Poziom ${levelForXp(p.xp)} • ${number(p.xp)} XP`,
                inline: true,
              },
              { name: "Role", value: roles.slice(0, 950) || "Brak" },
            ),
        ],
      });
    }
  }
}
