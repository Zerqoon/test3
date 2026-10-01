import {
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
  type TextChannel,
  type NewsChannel,
} from "discord.js";
import type { Context } from "../types.js";
import { config } from "../config.js";
import { assert, UserError } from "../utils/errors.js";
import { clean, number, stamp } from "../utils/format.js";
import { embed } from "../utils/embeds.js";
import {
  assertSafeRole,
  assertTarget,
  requireStaff,
} from "../services/access.js";

import { issueWarning, updateWarningStage } from "../services/warnings.js";
import { curateTenor, blockGif } from "../services/media.js";

type WriteChannel = TextChannel | NewsChannel;
const locks = new Set<string>();
async function toggleLock(
  i: ChatInputCommandInteraction,
  ctx: Context,
  reason: string,
  locking: boolean,
) {
  const channel = i.channel;
  assert(
    channel &&
      "permissionOverwrites" in channel &&
      "setRateLimitPerUser" in channel,
    "Komenda działa na zwykłym kanale tekstowym.",
  );
  assert(!locks.has(channel.id), "Trwa już zmiana blokady tego kanału.");
  locks.add(channel.id);
  const key = `lock:${channel.id}`;
  try {
    if (locking) {
      assert(
        !ctx.store.setting(key),
        "Ten kanał jest już zablokowany przez bota. Użyj /moderacja unlock.",
      );
      const ids = [
        ...new Set([
          i.guild!.id,
          config.roles.community,
          ...config.roles.levels.map((r) => r.id),
          ...channel.permissionOverwrites.cache
            .filter((o) => o.type === 0 && o.id !== config.roles.quarantine)
            .map((o) => o.id),
          config.roles.owner,
          config.roles.moderator,
          i.client.user.id,
        ]),
      ];
      const saved = ids.map((id) => {
        const old = channel.permissionOverwrites.cache.get(id);
        const value = (bit: bigint) =>
          old?.allow.has(bit) ? true : old?.deny.has(bit) ? false : null;
        return {
          id,
          SendMessages: value(PermissionFlagsBits.SendMessages),
          SendMessagesInThreads: value(
            PermissionFlagsBits.SendMessagesInThreads,
          ),
        };
      });
      ctx.store.setSetting(key, JSON.stringify(saved));
      // Keep the bot able to send logs and command output after denying @everyone.
      await channel.permissionOverwrites.edit(
        i.client.user.id,
        { SendMessages: true, SendMessagesInThreads: true },
        { reason },
      );
      for (const id of ids.filter((id) => id !== i.client.user.id))
        await channel.permissionOverwrites.edit(
          id,
          {
            SendMessages:
              id === config.roles.owner || id === config.roles.moderator,
            SendMessagesInThreads:
              id === config.roles.owner || id === config.roles.moderator,
          },
          { reason },
        );
    } else {
      const raw = ctx.store.setting(key);
      assert(raw, "Nie ma zapisanej blokady bota. Nie zmieniono uprawnień.");
      const saved = JSON.parse(raw) as {
        id: string;
        SendMessages: boolean | null;
        SendMessagesInThreads: boolean | null;
      }[];
      for (const item of saved) {
        await channel.permissionOverwrites.edit(
          item.id,
          {
            SendMessages: item.SendMessages,
            SendMessagesInThreads: item.SendMessagesInThreads,
          },
          { reason },
        );
        const overwrite = channel.permissionOverwrites.cache.get(item.id);
        if (
          overwrite &&
          overwrite.allow.bitfield === 0n &&
          overwrite.deny.bitfield === 0n
        )
          await overwrite.delete(reason);
      }
      ctx.store.db.prepare("DELETE FROM settings WHERE key=?").run(key);
    }
  } finally {
    locks.delete(channel.id);
  }
}

export async function moderation(
  i: ChatInputCommandInteraction,
  actor: GuildMember,
  ctx: Context,
) {
  requireStaff(actor);
  const guild = i.guild!;
  const me = await guild.members.fetchMe();
  const sub = i.options.getSubcommand();
  const reason = i.options.getString("powod") ?? "Sprawdzenie historii";
  const auditReason = `${actor.user.tag} (${actor.id}) • ${reason}`.slice(
    0,
    500,
  );
  if (sub === "gif-dopusc" || sub === "gif-zablokuj") {
    let url: URL;
    try {
      url = new URL(i.options.getString("adres", true));
    } catch {
      throw new UserError("Podaj prawidłowy link HTTPS do GIF-a.");
    }
    const canonical =
      sub === "gif-dopusc"
        ? curateTenor(ctx.store, url, reason, actor.id)
        : blockGif(ctx.store, url, actor.id, reason);
    ctx.logs.action(
      sub === "gif-dopusc" ? "Zatwierdzono GIF Tenor" : "Zablokowano GIF",
      actor.id,
      actor.id,
      `${reason} • ${url.href}`,
    );
    await i.editReply({
      embeds: [
        embed(
          sub === "gif-dopusc" ? "GIF zatwierdzony" : "GIF zablokowany",
          sub === "gif-dopusc"
            ? `GIF będzie dostępny przez 30 dni i w katalogu /gif zrodlo:tenor.\n${canonical}`
            : `Ten materiał nie będzie dopuszczany przez filtr.\nPowód: ${clean(reason)}`,
        ),
      ],
    });
    return;
  }
  if (sub === "sprawy") {
    const user = i.options.getUser("osoba", true);
    const rows = ctx.store.cases(guild.id, user.id);
    await i.editReply({
      embeds: [
        embed(
          `Historia moderacji • ${clean(user.username, 80)}`,
          rows
            .map(
              (r) =>
                `**#${r.id} • ${r.type.toUpperCase()}${r.type === "warn" && !r.active ? " (cofnięte)" : ""}** ${stamp(r.created_at)}\n${clean(r.reason, 110)} • <@${r.moderator_id}>`,
            )
            .join("\n\n") || "Brak zapisanych spraw.",
        ),
      ],
    });
    return;
  }
  if (sub === "unwarn") {
    const caseId = i.options.getInteger("id", true);
    const row = ctx.store.db
      .prepare(
        "SELECT user_id FROM mod_cases WHERE guild_id=? AND id=? AND type='warn' AND active=1",
      )
      .get(guild.id, caseId) as { user_id: string } | undefined;
    assert(row, "Nie znaleziono aktywnego ostrzeżenia.");
    const target = await guild.members.fetch(row.user_id).catch(() => null);
    if (target) assertTarget(actor, target);
    assert(
      ctx.store.revokeWarn(guild.id, caseId),
      "Nie znaleziono aktywnego ostrzeżenia.",
    );
    ctx.store.db
      .prepare(
        "UPDATE mod_cases SET revoked_reason=? WHERE guild_id=? AND id=?",
      )
      .run(reason, guild.id, caseId);
    updateWarningStage(ctx, guild.id, row.user_id);
    ctx.logs.action(
      "Cofnięto ostrzeżenie",
      row.user_id,
      actor.id,
      reason,
      caseId,
    );
    await i.editReply({
      embeds: [
        embed(
          "Ostrzeżenie cofnięte",
          `Sprawa **#${caseId}**. Historia została zachowana.`,
        ),
      ],
    });
    return;
  }
  if (sub === "unban") {
    assert(
      me.permissions.has(PermissionFlagsBits.BanMembers),
      "Bot potrzebuje uprawnienia Ban Members.",
    );
    const id = i.options.getString("id", true);
    assert(/^\d{17,20}$/.test(id), "Nieprawidłowe ID użytkownika.");
    assert(id !== guild.ownerId, "Owner nie może być celem tej akcji.");
    await guild.bans.remove(id, auditReason);
    const caseId = ctx.store.addCase(guild.id, id, actor.id, sub, reason);
    ctx.logs.action("UNBAN", id, actor.id, reason, caseId);
    await i.editReply({
      embeds: [embed("Ban zdjęty", `Osoba: <@${id}> • Sprawa #${caseId}`)],
    });
    return;
  }
  if (["clear", "slowmode", "lock", "unlock"].includes(sub)) {
    const channel = i.channel;
    assert(
      channel && "bulkDelete" in channel && "permissionsFor" in channel,
      "Komenda wymaga kanału tekstowego serwera.",
    );
    const needed =
      sub === "clear"
        ? PermissionFlagsBits.ManageMessages
        : PermissionFlagsBits.ManageChannels;
    assert(
      channel.permissionsFor(me)?.has(needed),
      "Bot nie ma wymaganych uprawnień na tym kanale.",
    );
    if (sub === "clear") {
      const amount = i.options.getInteger("ilosc", true);
      const reply = await i.fetchReply();
      const recent = await channel.messages.fetch({
        limit: Math.min(100, amount + 1),
      });
      if (amount === 100 && recent.has(reply.id) && recent.size === 100) {
        const last = recent.last()!;
        const extra = await channel.messages.fetch({
          limit: 1,
          before: last.id,
        });
        for (const [id, m] of extra) recent.set(id, m);
      }
      const selected = recent.filter((m) => m.id !== reply.id).first(amount);
      const messages = await channel.bulkDelete(selected, true);
      ctx.logs.action(
        `CLEAR ${messages.size} wiadomości w #${channel.name}`,
        channel.id,
        actor.id,
        reason,
      );
      await i.editReply({
        embeds: [
          embed(
            "Kanał uporządkowany",
            `Usunięto **${messages.size}** wiadomości. Wiadomości starsze niż 14 dni pominięto.`,
          ),
        ],
      });
    } else if (sub === "slowmode") {
      assert(
        "setRateLimitPerUser" in channel,
        "Slowmode jest dostępny na zwykłym kanale tekstowym.",
      );
      const seconds = i.options.getInteger("sekundy", true);
      await (channel as WriteChannel).setRateLimitPerUser(seconds, auditReason);
      ctx.logs.action(
        `SLOWMODE ${seconds}s w #${channel.name}`,
        channel.id,
        actor.id,
        reason,
      );
      await i.editReply({
        embeds: [
          embed(
            "Tryb powolny zmieniony",
            `Odstęp między wiadomościami: **${seconds}s**.`,
          ),
        ],
      });
    } else {
      assert(
        channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageRoles),
        "Bot potrzebuje Manage Roles, aby zmieniać nadpisania kanału.",
      );
      await toggleLock(i, ctx, auditReason, sub === "lock");
      ctx.logs.action(
        `${sub.toUpperCase()} w #${channel.name}`,
        channel.id,
        actor.id,
        reason,
      );
      await i.editReply({
        embeds: [
          embed(
            sub === "lock" ? "Kanał zablokowany" : "Kanał odblokowany",
            sub === "lock"
              ? "Pisanie i wątki zablokowano dla zwykłych ról. Owner, Moderator i bot zachowują dostęp."
              : "Przywrócono zapisane nadpisania dotyczące wysyłania wiadomości.",
          ),
        ],
      });
    }
    return;
  }
  const user = i.options.getUser("osoba", true);
  const target = await guild.members.fetch({ user: user.id, force: true });
  assertTarget(actor, target);
  if (sub === "warn") {
    const result = await issueWarning(
      ctx,
      target,
      actor.id,
      reason,
      i.options.getInteger("punkty") ?? 1,
      i.id,
    );
    await i.editReply({ embeds: [result.embed] });
    return;
  }
  if (sub === "timeout" || sub === "untimeout") {
    assert(
      sub !== "untimeout" || !ctx.store.isQuarantined(guild.id, target.id),
      "Kwarantannę może zakończyć Owner przez /admin kwarantanna. Nie zdejmuj jej timeoutu osobno.",
    );
    const q = ctx.store.quarantine(guild.id, target.id);
    assert(
      sub !== "timeout" ||
        !q ||
        q.released_at ||
        Date.now() + i.options.getInteger("minuty", true) * 60000 >= q.until_at,
      "Timeout nie może skracać aktywnej kwarantanny. Owner może ją zakończyć przez /admin kwarantanna.",
    );
    assert(
      me.permissions.has(PermissionFlagsBits.ModerateMembers) &&
        target.moderatable,
      "Bot nie może wyciszyć tej osoby. Sprawdź uprawnienia i hierarchię.",
    );
    await target.timeout(
      sub === "timeout" ? i.options.getInteger("minuty", true) * 60000 : null,
      auditReason,
    );
  } else if (sub === "kick") {
    assert(
      me.permissions.has(PermissionFlagsBits.KickMembers) && target.kickable,
      "Bot nie może wyrzucić tej osoby. Sprawdź hierarchię.",
    );
    await target.kick(auditReason);
  } else if (sub === "ban") {
    assert(
      me.permissions.has(PermissionFlagsBits.BanMembers) && target.bannable,
      "Bot nie może zbanować tej osoby. Sprawdź hierarchię.",
    );
    await target.ban({ reason: auditReason });
  } else if (sub === "nick") {
    assert(
      me.permissions.has(PermissionFlagsBits.ManageNicknames) &&
        target.manageable,
      "Bot nie może zmienić pseudonimu tej osoby.",
    );
    await target.setNickname(i.options.getString("nazwa", true), auditReason);
  } else if (sub === "rola") {
    assert(
      !ctx.store.isQuarantined(guild.id, target.id),
      "Najpierw zakończ kwarantannę tej osoby.",
    );
    assert(
      me.permissions.has(PermissionFlagsBits.ManageRoles),
      "Bot potrzebuje uprawnienia Manage Roles.",
    );
    const role = await guild.roles.fetch(i.options.getRole("rola", true).id);
    assert(role, "Nie znaleziono roli.");
    assertSafeRole(actor, role);
    if (i.options.getString("akcja", true) === "add")
      await target.roles.add(role, auditReason);
    else await target.roles.remove(role, auditReason);
  }
  const caseId = ctx.store.addCase(guild.id, target.id, actor.id, sub, reason);
  ctx.logs.action(sub.toUpperCase(), target.id, actor.id, reason, caseId);
  await i.editReply({
    embeds: [
      embed(
        "Akcja wykonana",
        `**${sub.toUpperCase()}** • <@${target.id}>\nSprawa **#${number(caseId)}** • ${clean(reason)}`,
      ),
    ],
  });
}
