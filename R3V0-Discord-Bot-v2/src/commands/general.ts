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
import { roleXpMultiplier } from "../services/xp.js";

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
              "`/poziom` `/profil` `/ranking typ:xp`\nXP za pisanie i voice, boostery XP i zaawansowane Canvas.",
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
            name: "Roblox, voice i ostrzeżenia",
            value:
              "`/weryfikacja polacz | sprawdz | status | odswiez`\n`/voice panel` `/gif szukaj:`\n`/ostrzezenia lista | dodaj | usun`",
          },
          {
            name: "Owner",
            value:
              "`/admin diagnostyka | publikuj | synchronizacja`\n`/admin poziom | waluta | backup | kwarantanna`\n`/setup` `/setup-regulamin` `/setup-weryfikacja` `/setup-voice`",
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
      day_base_xp: p.xp_day === dayKey(Date.now()) ? p.day_base_xp : 0,
    };
    const rank = ctx.store.rank(guild.id, user.id);
    try {
      const png = await renderCard({
        kind: name === "profil" ? "profile" : "rank",
        profile,
        rank,
        avatarUrl: user.displayAvatarURL({ extension: "png", size: 256 }),
        boostMultiplier: ctx.store.xpMultiplier(
          guild.id,
          user.id,
          roleXpMultiplier(member),
        ),
        robloxName: ctx.store.link(guild.id, user.id)?.roblox_name,
        quarantineUntil: ctx.store.isQuarantined(guild.id, user.id)
          ? ctx.store.quarantine(guild.id, user.id)?.until_at
          : undefined,
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
            "R3V0 • Status",
            `Czas działania: **${duration(Date.now() - ctx.startedAt)}**\nGateway: **${ctx.client.ws.ping} ms**\nPamięć RSS: **${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB**\nWersja: **2.0.0**\n\n✅ Moderacja i punktowe ostrzeżenia\n✅ Czytelne logi i trwała kolejka\n✅ XP za pisanie / voice i Canvas\n✅ Sklep 40 boosterów XP\n✅ Weryfikacja własności Roblox\n✅ Kwarantanna nowych kont i antylink\n✅ Prywatny voice z panelem\n✅ SQLite, migracje i kopie zapasowe`,
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
