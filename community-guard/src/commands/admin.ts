import {
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
} from "discord.js";
import type { Context } from "../types.js";
import { config } from "../config.js";
import { assert } from "../utils/errors.js";
import { embed } from "../utils/embeds.js";
import { number } from "../utils/format.js";
import { requireOwner, dangerousPermissions } from "../services/access.js";
import { giveCommunity, syncLevelRoles } from "../services/roles.js";
import { rulesPanel, infoPanel, guidePanel } from "./panels.js";
import { backup } from "../services/backup.js";
import { logger } from "../utils/logger.js";

let syncing = false;
export async function diagnostics(
  i: ChatInputCommandInteraction,
  ctx: Context,
) {
  const guild = i.guild!;
  const me = await guild.members.fetchMe();
  await guild.roles.fetch();
  const roles = [
    ["Owner", config.roles.owner],
    ["Moderator", config.roles.moderator],
    ["Community", config.roles.community],
    ...config.roles.levels.map((r) => [`Poziom ${r.level}`, r.id]),
  ];
  const roleLines = roles.map(([name, id]) => {
    const role = guild.roles.cache.get(id);
    if (!role) return `❌ ${name} — nie znaleziono (${id})`;
    const managedByBot =
      id !== config.roles.owner && id !== config.roles.moderator;
    return `${!managedByBot || role.editable ? "✅" : "❌"} ${name} — ${managedByBot && !role.editable ? "rola bota za nisko" : "OK"}${managedByBot && (role.permissions.bitfield & dangerousPermissions) !== 0n ? " • ⚠ uprawnienia administracji" : ""}`;
  });
  const channelLines: string[] = [];
  for (const [name, id] of Object.entries(config.channels)) {
    const c = await guild.channels.fetch(id).catch(() => null);
    const perms = c?.permissionsFor(me);
    const ok =
      c?.isSendable() &&
      perms?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
      ]);
    channelLines.push(
      `${ok ? "✅" : "❌"} ${name}: <#${id}>${ok ? "" : " — sprawdź dostęp, wysyłanie, embedy i pliki"}`,
    );
  }
  const perms = [
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.ViewAuditLog,
    PermissionFlagsBits.ModerateMembers,
    PermissionFlagsBits.KickMembers,
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageNicknames,
    PermissionFlagsBits.ReadMessageHistory,
  ];
  const outbox = ctx.store.db
    .prepare("SELECT COUNT(*) AS n FROM log_outbox")
    .get() as { n: number };
  await i.editReply({
    embeds: [
      embed("Diagnostyka konfiguracji").addFields(
        { name: "Role", value: roleLines.join("\n") },
        { name: "Kanały", value: channelLines.join("\n") },
        {
          name: "Uprawnienia bota",
          value: perms
            .map(
              (p) =>
                `${me.permissions.has(p) ? "✅" : "❌"} ${Object.entries(PermissionFlagsBits).find(([, v]) => v === p)?.[0]}`,
            )
            .join("\n"),
        },
        {
          name: "Dane",
          value: `SQLite: aktywna\nKolejka logów: **${outbox.n}**\nPoziomy: **${config.leveling.enabled ? "włączone" : "wyłączone"}**\nKanał komend: <#${config.channels.commands}>`,
        },
      ),
    ],
  });
}
export async function admin(
  i: ChatInputCommandInteraction,
  actor: GuildMember,
  ctx: Context,
) {
  requireOwner(actor);
  const guild = i.guild!;
  const sub = i.options.getSubcommand();
  if (sub === "diagnostyka") {
    await diagnostics(i, ctx);
    return;
  }
  if (sub === "publikuj") {
    const id = i.options.getChannel("kanal")?.id ?? i.channelId;
    const channel = await guild.channels.fetch(id);
    assert(channel?.isSendable(), "Kanał nie jest dostępny do publikacji.");
    const type = i.options.getString("panel", true);
    const message = await channel.send(
      type === "rules"
        ? rulesPanel()
        : type === "info"
          ? infoPanel()
          : guidePanel(),
    );
    ctx.logs.action(
      `Opublikowano panel ${type}`,
      channel.id,
      actor.id,
      message.url,
    );
    await i.editReply({
      embeds: [
        embed("Panel opublikowany", `[Otwórz wiadomość](${message.url})`),
      ],
    });
    return;
  }
  if (sub === "backup") {
    const file = await backup(ctx.store);
    assert(file, "Kopia jest już tworzona.");
    ctx.logs.action(
      "BACKUP",
      actor.id,
      actor.id,
      "Zapisano kopię bazy w katalogu danych",
    );
    await i.editReply({
      embeds: [
        embed(
          "Kopia gotowa",
          "Spójna kopia bazy znajduje się w katalogu `backups` obok pliku SQLite. Na Railway zachowuje ją podłączony Volume.",
        ),
      ],
    });
    return;
  }
  if (sub === "synchronizacja") {
    assert(!syncing, "Synchronizacja już trwa.");
    syncing = true;
    let synced = 0;
    let failed = 0;
    try {
      const members = await guild.members.fetch();
      for (const member of members.values()) {
        if (member.user.bot) continue;
        try {
          ctx.store.member(guild.id, member.id, true, member.displayName);
          await giveCommunity(member);
          await syncLevelRoles(member, ctx.store);
          synced++;
        } catch (err) {
          failed++;
          logger.warn(
            { err, userId: member.id },
            "Nie udało się zsynchronizować ról",
          );
        }
      }
      ctx.logs.action(
        "Synchronizacja ról",
        guild.id,
        actor.id,
        `${synced} poprawnie, ${failed} błędów`,
      );
      await i.editReply({
        embeds: [
          embed(
            "Synchronizacja zakończona",
            `Poprawnie: **${synced}**\nBłędy: **${failed}**${failed ? "\nSprawdź /admin diagnostyka oraz logi Railway." : ""}`,
          ),
        ],
      });
    } finally {
      syncing = false;
    }
    return;
  }
  const user = i.options.getUser("osoba", true);
  assert(!user.bot, "Boty nie mają poziomów ani kont ekonomii.");
  const member = await guild.members.fetch(user.id);
  ctx.store.profile(guild.id, user.id, member.displayName);
  const reason = i.options.getString("powod", true);
  if (sub === "poziom") {
    const value = i.options.getInteger("wartosc", true);
    ctx.store.setLevel(guild.id, user.id, value);
    try {
      await syncLevelRoles(member, ctx.store);
    } catch (err) {
      ctx.logs.action(
        "Zmieniono poziom; role czekają na synchronizację",
        user.id,
        actor.id,
        reason,
      );
      throw err;
    }
    ctx.logs.action(`Ustawiono poziom ${value}`, user.id, actor.id, reason);
    await i.editReply({
      embeds: [
        embed(
          "Poziom ustawiony",
          `<@${user.id}> • Poziom **${value}**. Role wyrównano do progów.`,
        ),
      ],
    });
  } else if (sub === "waluta") {
    const amount = i.options.getInteger("zmiana", true);
    const r = ctx.store.adjustMoney(
      guild.id,
      user.id,
      amount,
      i.id,
      `Owner ${actor.id}: ${reason}`,
    );
    ctx.logs.action(
      `Zmiana salda ${amount >= 0 ? "+" : ""}${number(amount)}`,
      user.id,
      actor.id,
      reason,
    );
    await i.editReply({
      embeds: [
        embed(
          "Saldo zmienione",
          `<@${user.id}> • Saldo **${number(r.balance)} ${config.brand.currency}**.`,
        ),
      ],
    });
  }
}
