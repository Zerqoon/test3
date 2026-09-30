import { type GuildMember } from "discord.js";
import { dangerousPermissions } from "./access.js";
import { config } from "../config.js";
import { assert } from "../utils/errors.js";
import { levelForXp } from "./levels.js";
import type { Store } from "./store.js";

export async function syncLevelRoles(member: GuildMember, store: Store) {
  const level = levelForXp(store.profile(member.guild.id, member.id).xp);
  const desired = config.roles.levels
    .filter((r) => level >= r.level)
    .map((r) => r.id);
  const add = desired.filter((id) => !member.roles.cache.has(id));
  const remove = config.roles.levels
    .filter((r) => level < r.level && member.roles.cache.has(r.id))
    .map((r) => r.id);
  for (const id of [...add, ...remove]) {
    const role = member.guild.roles.cache.get(id);
    assert(role?.editable, `Brak roli ${id} albo rola bota jest zbyt nisko.`);
    assert(
      (role.permissions.bitfield & dangerousPermissions) === 0n,
      `Rola poziomu ${role.name} nie może nadawać uprawnień administracji.`,
    );
  }
  if (add.length)
    await member.roles.add(
      add,
      `Poziom ${level} — automatyczna synchronizacja`,
    );
  if (remove.length)
    await member.roles.remove(
      remove,
      `Poziom ${level} — synchronizacja progów`,
    );
  return add;
}
export async function giveCommunity(member: GuildMember) {
  if (member.user.bot || member.roles.cache.has(config.roles.community)) return;
  const role = member.guild.roles.cache.get(config.roles.community);
  assert(
    role?.editable,
    "Nie można nadać Community. Sprawdź ID i hierarchię roli bota.",
  );
  assert(
    (role.permissions.bitfield & dangerousPermissions) === 0n,
    "Rola Community nie może nadawać uprawnień administracji.",
  );
  await member.roles.add(role, "Automatyczna rola Community po dołączeniu");
}
