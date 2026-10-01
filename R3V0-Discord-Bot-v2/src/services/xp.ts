import { AttachmentBuilder, type GuildMember } from "discord.js";
import type { CoreContext } from "../types.js";
import { config } from "../config.js";
import { syncLevelRoles } from "./roles.js";
import { renderCard } from "../canvas/cards.js";
import { embed } from "../utils/embeds.js";
import { logger } from "../utils/logger.js";
export function roleXpMultiplier(member: GuildMember) {
  return member.roles.cache.has(config.roles.booster)
    ? config.leveling.boosterMultiplier
    : 1;
}
export async function applyLevelReward(
  member: GuildMember,
  result: { oldLevel: number; newLevel: number },
  ctx: CoreContext,
) {
  let gained: string[] = [];
  try {
    gained = await syncLevelRoles(member, ctx.store);
  } catch (err) {
    logger.warn(
      { err, userId: member.id },
      "Poziom zapisano; role czekają na synchronizację",
    );
  }
  if (result.newLevel <= result.oldLevel) return;
  const roles = config.roles.levels
    .filter((r) => gained.includes(r.id))
    .map((r) => r.label)
    .join(" • ");
  const channel = await member.guild.channels.fetch(config.channels.levels);
  if (!channel?.isSendable()) return;
  try {
    const png = await renderCard({
      kind: "levelup",
      profile: ctx.store.profile(member.guild.id, member.id),
      rank: ctx.store.rank(member.guild.id, member.id),
      avatarUrl: member.user.displayAvatarURL({ extension: "png", size: 256 }),
      subtitle: roles
        ? `Odblokowano: ${roles}`
        : "Kolejny poziom zdobyty. Tak trzymaj!",
    });
    await channel.send({
      content: `<@${member.id}> awansuje na **poziom ${result.newLevel}**!`,
      files: [new AttachmentBuilder(png, { name: "awans.png" })],
      allowedMentions: { users: [member.id] },
    });
  } catch (err) {
    logger.warn(
      { err, userId: member.id },
      "Karta awansu niedostępna; używam embedu",
    );
    await channel.send({
      embeds: [
        embed(
          "Nowy poziom!",
          `<@${member.id}> • **Poziom ${result.newLevel}**${roles ? `\n${roles}` : ""}`,
        ),
      ],
      allowedMentions: { users: [member.id] },
    });
  }
}
