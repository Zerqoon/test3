import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import {
  Collection,
  ChannelType,
  type Guild,
  type GuildMember,
  type VoiceState,
  type Client,
} from "discord.js";
import { Store } from "../src/services/store.js";
import { config } from "../src/config.js";
import { dayKey } from "../src/utils/format.js";
import {
  VoiceManager,
  validVoiceLimit,
  validVoiceName,
} from "../src/services/voice.js";
import { accountIsNew } from "../src/services/protection.js";
import { issueWarning } from "../src/services/warnings.js";
import { auditChangeFields } from "../src/services/audit-format.js";
import { boundedEmbed, embed } from "../src/utils/embeds.js";
import type { CoreContext, Context } from "../src/types.js";
const g = "1540000000000000000",
  u = "1540000000000000001",
  v = "1540000000000000002",
  now = Date.UTC(2026, 9, 1, 12);
test("XP tekst + voice mają wspólny bazowy limit, mnożnik 7.5 i zachowują pół punktu", () => {
  const s = new Store(":memory:");
  try {
    s.profile(g, u);
    s.db
      .prepare(
        "UPDATE profiles SET xp_day=?,day_base_xp=?,xp_boost_multiplier=5,xp_boost_until=? WHERE guild_id=? AND user_id=?",
      )
      .run(dayKey(now), 1197, now + 3600000, g, u);
    assert.equal(
      s.awardXp(
        g,
        u,
        "Wiadomość kończąca dzisiejszy limit bazowy.",
        "last",
        now,
        10,
        1.5,
      )?.gained,
      22,
    );
    assert.equal(s.awardVoiceXp(g, u, "v1", now, 8, 1.5), null);
    assert.equal(s.profile(g, u).day_base_xp, 1200);
    assert.equal(s.profile(g, u).voice_seconds, 60);
    assert.equal(s.awardVoiceXp(g, u, "v1", now, 8, 1.5), null);
    assert.equal(s.profile(g, u).voice_seconds, 60);
    assert.equal(
      s.awardXp(
        g,
        v,
        "Pierwsza normalna wiadomość z mnożnikiem.",
        "odd1",
        now,
        11,
        1.5,
      )?.gained,
      16,
    );
    assert.equal(
      s.awardXp(
        g,
        v,
        "Druga zupełnie inna wiadomość z mnożnikiem.",
        "odd2",
        now + 100000,
        11,
        1.5,
      )?.gained,
      17,
    );
    assert.equal(s.profile(g, v).xp, 33);
  } finally {
    s.close();
  }
});
test("Kwarantanna przetrwa wyjście, powrót i restart; bot nie przyzna tekst/voice XP", () => {
  const dir = mkdtempSync(join(tmpdir(), "quarantine-")),
    path = join(dir, "db.sqlite");
  let s = new Store(path);
  try {
    const q = s.startQuarantine(g, u, [config.roles.community], now);
    assert.equal(q.until_at, now + 72 * 3600000);
    s.member(g, u, false);
    s.close();
    s = new Store(path);
    s.member(g, u, true);
    assert.equal(
      s.startQuarantine(g, u, [], now + 3600000).until_at,
      q.until_at,
    );
    assert.equal(
      s.awardXp(
        g,
        u,
        "Pełna wiadomość wysłana mimo kwarantanny.",
        "blocked",
        now + 3600000,
        16,
      ),
      null,
    );
    assert.equal(s.awardVoiceXp(g, u, "blocked", now + 3600000, 8), null);
    assert.equal(s.profile(g, u).xp, 0);
    assert.equal(s.profile(g, u).voice_seconds, 0);
    assert.equal(accountIsNew(now - 71 * 3600000, now), true);
    assert.equal(accountIsNew(now - 72 * 3600000, now), false);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Warny są idempotentne, wygasają i nie sumują się po cofnięciu", () => {
  const s = new Store(":memory:");
  try {
    const first = s.warning(g, u, "mod", "Invite", 2, "one", now);
    assert.deepEqual(s.warning(g, u, "mod", "Invite", 2, "one", now), first);
    assert.equal(s.warningPoints(g, u, now), 2);
    const second = s.warning(g, u, "mod", "Spam", 1, "two", now);
    assert.equal(second.points, 3);
    assert.equal(s.warningPoints(g, u, now + 30 * 86400000), 0);
    s.revokeWarn(g, first.id);
    assert.equal(s.warningPoints(g, u, now), 1);
    assert.equal(s.cases(g, u).length, 2);
  } finally {
    s.close();
  }
});
test("Ostrzeżenia realizują progi i nie skracają dłuższego timeoutu", async () => {
  const s = new Store(":memory:");
  let timeout = Date.now() + 86400000;
  const applied: number[] = [];
  const target = {
    id: u,
    guild: { id: g },
    user: {
      displayAvatarURL: () => "https://cdn.discordapp.com/embed/avatars/0.png",
    },
    moderatable: true,
    get communicationDisabledUntilTimestamp() {
      return timeout;
    },
    disableCommunicationUntil: async (value: number) => {
      timeout = value;
      applied.push(value);
    },
    send: async () => {},
  } as unknown as GuildMember;
  const ctx = {
    store: s,
    client: { user: { id: "bot" } },
    logs: { audit: () => {} },
  } as unknown as Context;
  try {
    await issueWarning(ctx, target, "mod", "First", 2, "1");
    assert.equal(applied.length, 0);
    await issueWarning(ctx, target, "mod", "Second", 1, "2");
    assert.equal(applied.length, 1);
    assert.ok(applied[0] >= Date.now() + 86300000);
    await issueWarning(ctx, target, "mod", "Third", 1, "3");
    assert.equal(applied.length, 1);
    assert.equal(s.warningPoints(g, u), 4);
  } finally {
    s.close();
  }
});
test("Jedno konto Roblox nie może zweryfikować dwóch Discordów; stary kod jest unieważniany", () => {
  const s = new Store(":memory:");
  try {
    for (const id of [u, v])
      s.db
        .prepare("INSERT INTO verification_challenges VALUES (?,?,?,?,?,?,?,0)")
        .run(g, id, "12345", "Roblox", "CODE", id, now + 60000);
    s.completeVerification(
      s.challenge(g, u)!,
      "Roblox",
      "Zerqon (@roblox)",
      now,
    );
    assert.throws(
      () =>
        s.completeVerification(
          s.challenge(g, v)!,
          "Roblox",
          "Other (@roblox)",
          now,
        ),
      /przypisane/,
    );
    assert.equal(s.link(g, v), undefined);
    const challenge = s.challenge(g, v)!;
    s.db
      .prepare("UPDATE verification_challenges SET code='NEW' WHERE user_id=?")
      .run(v);
    assert.throws(
      () => s.completeVerification(challenge, "Roblox", "Other (@roblox)", now),
      /zastąpiony/,
    );
  } finally {
    s.close();
  }
});
test("Voice wymaga ciągłego przedziału, dwóch osób i zeruje odcinek po mute lub rozłączeniu", async () => {
  const store = new Store(":memory:");
  const channelId = "1550000000000000001";
  const members = new Collection<string, GuildMember>();
  const channel = { id: channelId, type: ChannelType.GuildVoice, members };
  const guild = {
    id: g,
    afkChannelId: null,
    channels: { cache: new Collection([[channelId, channel]]) },
    members: { cache: members },
  } as unknown as Guild;
  const create = (id: string) => {
    const voice = {
      id,
      channelId,
      guild,
      member: null,
      selfMute: false,
      serverMute: false,
      selfDeaf: false,
      serverDeaf: false,
      suppress: false,
    } as unknown as VoiceState;
    const m = {
      id,
      guild,
      displayName: id,
      pending: false,
      user: { bot: false },
      voice,
      roles: { cache: new Collection() },
    } as unknown as GuildMember;
    Object.assign(voice, { member: m });
    members.set(id, m);
    return m;
  };
  Object.assign(channel, { guild });
  const first = create(u);
  const ctx = {
    store,
    client: { isReady: () => true },
    logs: {},
  } as unknown as CoreContext;
  const manager = new VoiceManager(ctx);
  try {
    manager.refreshEligibility(guild, now);
    await manager.tick(guild, now + 60000);
    assert.equal(store.profile(g, u).xp, 0);
    const second = create(v);
    manager.refreshEligibility(guild, now + 60000);
    await manager.tick(guild, now + 119999);
    assert.equal(store.profile(g, u).xp, 0);
    await manager.tick(guild, now + 120000);
    assert.ok(store.profile(g, u).xp >= 4);
    assert.equal(store.profile(g, u).voice_seconds, 60);
    Object.assign(second.voice, { selfMute: true });
    manager.refreshEligibility(guild, now + 130000);
    await manager.tick(guild, now + 190000);
    assert.equal(store.profile(g, u).voice_seconds, 60);
    Object.assign(second.voice, { selfMute: false });
    manager.refreshEligibility(guild, now + 190000);
    manager.resetSessions();
    await manager.tick(guild, now + 250000);
    assert.equal(store.profile(g, u).voice_seconds, 60);
    await manager.tick(guild, now + 310000);
    assert.equal(store.profile(g, u).voice_seconds, 120);
  } finally {
    manager.stop();
    store.close();
  }
});
test("Panel voice odrzuca przekroczenie limitu i znaki sterujące w nazwach", () => {
  assert.equal(validVoiceLimit("1"), 1);
  assert.equal(validVoiceLimit("99"), 99);
  for (const value of ["0", "100", "1.5", "-1", "aa"])
    assert.throws(() => validVoiceLimit(value));
  assert.equal(validVoiceName("  Zerqon\n\u202E  "), "Zerqon");
  assert.throws(() => validVoiceName(" "));
});
test("Logi ról nie zawierają $add, JSON ani sekretów; duże embedy mieszczą się w 6000", () => {
  const fields = auditChangeFields([
    { key: "$add", new: [{ id: config.roles.moderator, name: "Moderator" }] },
    {
      key: "$remove",
      new: [{ id: config.roles.community, name: "Community" }],
    },
    { key: "token", new: "DO-NOT-LEAK" },
    { key: "permissions", old: "0", new: "8" },
  ]);
  const output = JSON.stringify(fields);
  assert.doesNotMatch(output, /\$add|\$remove|DO-NOT-LEAK|\\\"name\\\"/);
  assert.match(output, /Dodano role/);
  assert.match(output, /Odebrano role/);
  assert.match(output, /Administrator/);
  const e = embed("T".repeat(300), "D".repeat(4096)).addFields(
    ...Array.from({ length: 25 }, () => ({
      name: "N".repeat(256),
      value: "V".repeat(1024),
    })),
  );
  const bounded = boundedEmbed(e);
  const length =
    (bounded.title?.length ?? 0) +
    (bounded.description?.length ?? 0) +
    (bounded.footer?.text.length ?? 0) +
    (bounded.author?.name.length ?? 0) +
    (bounded.fields?.reduce(
      (sum, f) => sum + f.name.length + f.value.length,
      0,
    ) ?? 0);
  assert.ok(length <= 6000);
  assert.ok((bounded.fields?.length ?? 0) <= 25);
});
test("Migracja v1 zachowuje dane, wykonuje kopię i zwraca stare produkty tylko raz", () => {
  const folder = mkdtempSync(join(tmpdir(), "migration-")),
    path = join(folder, "db.sqlite");
  const old = new Database(path);
  old.exec(`CREATE TABLE profiles (guild_id TEXT NOT NULL,user_id TEXT NOT NULL,name TEXT NOT NULL DEFAULT 'Test',active INTEGER DEFAULT 1,xp INTEGER DEFAULT 0,messages INTEGER DEFAULT 0,balance INTEGER DEFAULT 0,last_xp INTEGER DEFAULT 0,xp_day TEXT DEFAULT '',day_xp INTEGER DEFAULT 0,recent_hashes TEXT DEFAULT '[]',last_work INTEGER DEFAULT 0,last_daily INTEGER DEFAULT 0,streak INTEGER DEFAULT 0,title TEXT DEFAULT '',boost_until INTEGER DEFAULT 0,PRIMARY KEY(guild_id,user_id));
  CREATE TABLE inventory(guild_id TEXT,user_id TEXT,item_id TEXT,quantity INTEGER,PRIMARY KEY(guild_id,user_id,item_id));
  CREATE TABLE mod_cases(id INTEGER PRIMARY KEY AUTOINCREMENT,guild_id TEXT,user_id TEXT,moderator_id TEXT,type TEXT,reason TEXT,created_at INTEGER,active INTEGER DEFAULT 1);
  PRAGMA user_version=1;`);
  old
    .prepare(
      "INSERT INTO profiles(guild_id,user_id,name,xp,balance,day_xp) VALUES (?,?,'Zerqon',15000,700,100)",
    )
    .run(g, u);
  old.prepare("INSERT INTO inventory VALUES (?,?, 'odkrywca',1)").run(g, u);
  old
    .prepare(
      "INSERT INTO mod_cases(guild_id,user_id,moderator_id,type,reason,created_at) VALUES (?,?,'mod','warn','Test',?)",
    )
    .run(g, u, now);
  old.close();
  let store = new Store(path);
  try {
    assert.equal(store.profile(g, u).xp, 15000);
    assert.equal(store.profile(g, u).text_xp, 15000);
    assert.equal(store.profile(g, u).balance, 3200);
    assert.equal(store.warningPoints(g, u, now), 1);
    assert.equal(readdirSync(join(folder, "backups")).length, 1);
    store.close();
    store = new Store(path);
    assert.equal(store.profile(g, u).balance, 3200);
    assert.equal(store.history(g, u).length, 1);
    assert.equal(store.cases(g, u).length, 1);
  } finally {
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
