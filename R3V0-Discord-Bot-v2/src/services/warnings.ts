import { type GuildMember, type ChatInputCommandInteraction } from "discord.js";
import type { Context } from "../types.js";
import { config } from "../config.js";
import { embed } from "../utils/embeds.js";
import { clean, stamp } from "../utils/format.js";
import { assertTarget, requireStaff } from "./access.js";
import { assert } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

const pendingWarnings = new Map<string, Promise<void>>();
export async function issueWarning(
  ctx: Context,
  target: GuildMember,
  moderator: string,
  reason: string,
  points: number,
  id: string,
) {
  const key = `${target.guild.id}:${target.id}`;
  const previous = pendingWarnings.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  pendingWarnings.set(key, tail);
  await previous;
  try {
    return await issueUnlocked(ctx, target, moderator, reason, points, id);
  } finally {
    release();
    if (pendingWarnings.get(key) === tail) pendingWarnings.delete(key);
  }
}
async function issueUnlocked(
  ctx: Context,
  target: GuildMember,
  moderator: string,
  reason: string,
  points: number,
  id: string,
) {
  updateWarningStage(ctx, target.guild.id, target.id);
  const result = ctx.store.warning(
    target.guild.id,
    target.id,
    moderator,
    reason,
    points,
    id,
  );
  const threshold = [...config.moderation.warnings.thresholds]
    .sort((a, b) => b.points - a.points)
    .find((t) => result.points >= t.points);
  const key = `warn-stage:${target.guild.id}:${target.id}`;
  const last = Number(ctx.store.setting(key) ?? 0);
  let escalation = "";
  if (threshold && threshold.points > last) {
    if (target.moderatable) {
      const until = Math.max(
        target.communicationDisabledUntilTimestamp ?? 0,
        Date.now() + threshold.timeoutMinutes * 60000,
      );
      try {
        await target.disableCommunicationUntil(
          until,
          `Ostrzeżenia: ${result.points} pkt; sprawa #${result.id}`,
        );
        ctx.store.setSetting(key, String(threshold.points));
        escalation = `Timeout do ${stamp(until)} (${threshold.timeoutMinutes} min).`;
        ctx.store.addCase(
          target.guild.id,
          target.id,
          ctx.client.user!.id,
          "auto-timeout",
          `Próg ${threshold.points} pkt; ostrzeżenie #${result.id}`,
        );
      } catch (err) {
        logger.warn(
          { err, userId: target.id },
          "Nie udało się zastosować progu ostrzeżeń",
        );
        escalation =
          "Ostrzeżenie zapisano. Timeout wymaga sprawdzenia uprawnień bota przez administrację.";
      }
    } else
      escalation =
        "Ostrzeżenie zapisano. Bot nie może nadać timeoutu tej osobie — sprawdź hierarchię ról.";
  }
  const e = embed(
    `Ostrzeżenie • #${result.id}`,
    `**Osoba:** <@${target.id}>\n**Powód:** ${clean(reason, 600)}\n**Dodano:** ${points} pkt • **Aktywne:** ${result.points} pkt`,
    "#FBBF24",
  )
    .setThumbnail(target.user.displayAvatarURL())
    .addFields(
      { name: "Wygasa", value: stamp(result.expires, "F") },
      {
        name: "System ostrzeżeń",
        value:
          escalation || "Progi: 3 pkt → 30 min • 5 pkt → 6 h • 7 pkt → 24 h.",
      },
    );
  ctx.logs.audit(e);
  await target
    .send({ embeds: [e], allowedMentions: { parse: [] } })
    .catch(() => {});
  return { ...result, embed: e };
}
export function updateWarningStage(ctx: Context, guild: string, user: string) {
  const points = ctx.store.warningPoints(guild, user);
  const tier =
    [...config.moderation.warnings.thresholds]
      .sort((a, b) => b.points - a.points)
      .find((t) => points >= t.points)?.points ?? 0;
  const key = `warn-stage:${guild}:${user}`;
  if (Number(ctx.store.setting(key) ?? 0) > tier)
    ctx.store.setSetting(key, String(tier));
}
export async function warningCommand(
  i: ChatInputCommandInteraction,
  actor: GuildMember,
  ctx: Context,
) {
  const sub = i.options.getSubcommand();
  const user = i.options.getUser("osoba") ?? i.user;
  if (sub === "dodaj") {
    requireStaff(actor);
    const target = await i.guild!.members.fetch(user.id);
    assertTarget(actor, target);
    updateWarningStage(ctx, i.guildId!, target.id);
    const r = await issueWarning(
      ctx,
      target,
      actor.id,
      i.options.getString("powod", true),
      i.options.getInteger("punkty") ?? 1,
      i.id,
    );
    await i.editReply({ embeds: [r.embed], allowedMentions: { parse: [] } });
    return;
  }
  if (sub === "usun") {
    requireStaff(actor);
    const id = i.options.getInteger("id", true);
    const row = ctx.store.db
      .prepare(
        "SELECT user_id FROM mod_cases WHERE guild_id=? AND id=? AND type='warn' AND active=1",
      )
      .get(i.guildId!, id) as { user_id: string } | undefined;
    assert(row, "Nie znaleziono aktywnego ostrzeżenia.");
    const target = await i.guild!.members.fetch(row.user_id).catch(() => null);
    if (target) assertTarget(actor, target);
    const reason = i.options.getString("powod", true);
    assert(
      ctx.store.revokeWarn(i.guildId!, id),
      "Ostrzeżenie już zostało cofnięte.",
    );
    ctx.store.db
      .prepare(
        "UPDATE mod_cases SET revoked_reason=? WHERE id=? AND guild_id=?",
      )
      .run(reason, id, i.guildId!);
    updateWarningStage(ctx, i.guildId!, row.user_id);
    ctx.logs.action("Cofnięto ostrzeżenie", row.user_id, actor.id, reason, id);
    await i.editReply({
      embeds: [
        embed(
          "Ostrzeżenie cofnięte",
          `<@${row.user_id}> • Sprawa **#${id}**.\nPowód: ${clean(reason)}\nPozostało **${ctx.store.warningPoints(i.guildId!, row.user_id)} pkt**.`,
        ),
      ],
    });
    return;
  }
  if (user.id !== i.user.id) requireStaff(actor);
  const now = Date.now();
  const rows = ctx.store
    .cases(i.guildId!, user.id)
    .filter((r) => r.type === "warn");
  const lines = rows.map(
    (r) =>
      `**#${r.id} • ${r.points} pkt • ${!r.active ? "cofnięte" : r.expires_at <= now ? "wygasłe" : "aktywne"}**\n${clean(r.reason, 130)} • <@${r.moderator_id}>\nWygasa ${stamp(r.expires_at)}${r.revoked_reason ? ` • Cofnięcie: ${clean(r.revoked_reason, 100)}` : ""}`,
  );
  await i.editReply({
    embeds: [
      embed(
        `Ostrzeżenia • ${clean(user.username, 70)}`,
        `Aktywne punkty: **${ctx.store.warningPoints(i.guildId!, user.id)}**\n\n${lines.join("\n\n") || "Brak ostrzeżeń."}`.slice(
          0,
          3900,
        ),
      ),
    ],
  });
}
