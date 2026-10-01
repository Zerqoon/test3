import test from "node:test";
import assert from "node:assert/strict";
import {
  Collection,
  GuildMember,
  PermissionFlagsBits,
  PermissionsBitField,
  type Role,
} from "discord.js";
import { config } from "../src/config.js";
import {
  commandLocationAllowed,
  requireOwner,
  assertSafeRole,
  assertTarget,
} from "../src/services/access.js";
function member(id: string, roles: string[] = [], position = 5) {
  return {
    id,
    client: { user: { id: "bot" } },
    guild: { id: "guild", ownerId: "actual-owner" },
    roles: {
      cache: new Collection(roles.map((r) => [r, {}])),
      highest: {
        comparePositionTo: (other: { position: number }) =>
          position - other.position,
        position,
      },
    },
  } as unknown as GuildMember;
}
test("Tylko wskazane role Owner i Moderator omijają kanał komend", () => {
  assert.equal(commandLocationAllowed(member("normal"), "other"), false);
  assert.equal(
    commandLocationAllowed(member("normal"), config.channels.commands),
    true,
  );
  assert.equal(
    commandLocationAllowed(
      member("moderator", [config.roles.moderator]),
      "other",
    ),
    true,
  );
  assert.equal(
    commandLocationAllowed(member("owner", [config.roles.owner]), "other"),
    true,
  );
  assert.throws(() =>
    requireOwner(member("moderator", [config.roles.moderator])),
  );
});
test("Moderacja chroni Ownera, innych moderatorów i osoby wyżej w hierarchii", () => {
  const mod = member("mod", [config.roles.moderator], 5);
  assert.throws(() => assertTarget(mod, member("actual-owner", [], 1)));
  assert.throws(() =>
    assertTarget(mod, member("mod2", [config.roles.moderator], 1)),
  );
  assert.throws(() => assertTarget(mod, member("higher", [], 6)));
  assert.doesNotThrow(() => assertTarget(mod, member("lower", [], 2)));
});
test("Moderator nie może przydzielić Administrator ani chronionych ról poziomów", () => {
  const mod = member("mod", [config.roles.moderator], 10);
  const role = {
    id: "generic",
    managed: false,
    editable: true,
    position: 2,
    permissions: new PermissionsBitField(PermissionFlagsBits.Administrator),
  } as unknown as Role;
  assert.throws(() => assertSafeRole(mod, role));
  assert.throws(() =>
    assertSafeRole(mod, {
      ...role,
      id: config.roles.levels[0].id,
      permissions: new PermissionsBitField(0n),
    } as Role),
  );
  assert.doesNotThrow(() =>
    assertSafeRole(mod, {
      ...role,
      permissions: new PermissionsBitField(PermissionFlagsBits.AttachFiles),
    } as Role),
  );
});
