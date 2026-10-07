import type { GuildMember, Interaction } from 'discord.js';
import type { Config } from './config.js';
import { UserError } from './util.js';

export function allowed(userId: string, roleIds: Iterable<string>, config: Config): boolean {
  if (config.access.ownerUserIds.includes(userId)) return true;
  const roles = new Set(roleIds);
  return config.access.staffRoleIds.some(id => roles.has(id));
}
export async function isStaff(interaction: Interaction, config: Config): Promise<boolean> {
  if (!interaction.guild) return false;
  if (config.access.ownerUserIds.includes(interaction.user.id)) return true;
  const member = await interaction.guild.members.fetch({ user: interaction.user.id, force: true });
  return allowed(member.id, member.roles.cache.keys(), config);
}
export async function requireStaff(interaction: Interaction, config: Config): Promise<void> {
  if (!(await isStaff(interaction, config))) throw new UserError('This action is restricted.');
}
export function protectedTarget(target: GuildMember, config: Config): boolean {
  return target.id === target.guild.ownerId || allowed(target.id, target.roles.cache.keys(), config);
}
