import {
  GuildMember,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Role,
} from "discord.js";
import { config } from "../config.js";
import { assert } from "../utils/errors.js";

export function isOwner(member: GuildMember) {
  return (
    member.id === member.guild.ownerId ||
    member.roles.cache.has(config.roles.owner)
  );
}
export function isStaff(member: GuildMember) {
  return isOwner(member) || member.roles.cache.has(config.roles.moderator);
}
export function commandLocationAllowed(member: GuildMember, channelId: string) {
  return (
    !config.moderation.commandChannelOnly ||
    isStaff(member) ||
    channelId === config.channels.commands
  );
}
export function requireStaff(member: GuildMember) {
  assert(isStaff(member), "Ta komenda jest dostępna dla Moderatora i Ownera.");
}
export function requireOwner(member: GuildMember) {
  assert(isOwner(member), "Ta komenda jest dostępna tylko dla Ownera.");
}
export async function getActor(i: ChatInputCommandInteraction) {
  assert(i.guild, "Komendy działają tylko na serwerze.");
  return i.guild.members.fetch({ user: i.user.id, force: true });
}
export function assertTarget(actor: GuildMember, target: GuildMember) {
  assert(actor.id !== target.id, "Nie możesz wykonać tej akcji na sobie.");
  assert(
    target.id !== target.client.user.id,
    "Nie możesz wykonać tej akcji na bocie.",
  );
  assert(!isOwner(target), "Nie można moderować Ownera.");
  assert(
    isOwner(actor) || !isStaff(target),
    "Moderator nie może moderować innych członków administracji.",
  );
  assert(
    actor.id === actor.guild.ownerId ||
      actor.roles.highest.comparePositionTo(target.roles.highest) > 0,
    "Twoja najwyższa rola musi być nad rolą wskazanej osoby.",
  );
}
export const dangerousPermissions =
  PermissionFlagsBits.Administrator |
  PermissionFlagsBits.ManageGuild |
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.ManageWebhooks |
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.ModerateMembers |
  PermissionFlagsBits.ManageMessages |
  PermissionFlagsBits.ManageNicknames |
  PermissionFlagsBits.MentionEveryone |
  PermissionFlagsBits.MoveMembers |
  PermissionFlagsBits.MuteMembers |
  PermissionFlagsBits.DeafenMembers;
export function assertSafeRole(actor: GuildMember, role: Role) {
  const protectedIds = [
    config.roles.owner,
    config.roles.moderator,
    config.roles.quarantine,
    config.roles.booster,
    ...config.roles.levels.map((r) => r.id),
  ];
  assert(
    !protectedIds.includes(role.id),
    "Role administracji i poziomów są chronione. Poziomy zmienia Owner przez /admin poziom.",
  );
  assert(
    !role.managed && role.id !== actor.guild.id,
    "Tej roli nie można zmieniać.",
  );
  assert(role.editable, "Rola bota musi znajdować się nad wskazaną rolą.");
  assert(
    actor.id === actor.guild.ownerId ||
      actor.roles.highest.comparePositionTo(role) > 0,
    "Nie możesz zarządzać rolą równą lub wyższą od swojej.",
  );
  assert(
    isOwner(actor) || (role.permissions.bitfield & dangerousPermissions) === 0n,
    "Role z uprawnieniami administracji może zmieniać tylko Owner.",
  );
}
