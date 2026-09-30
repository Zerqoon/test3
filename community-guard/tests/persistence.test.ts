import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/services/store.js";
test("Restart zachowuje XP, saldo, treść usuniętej wiadomości, warny i niewysłane logi", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-test-"));
  const path = join(dir, "test.sqlite");
  const g = "1540000000000000000";
  const u = "1540000000000000001";
  const time = Date.now();
  let s = new Store(path);
  try {
    s.adjustMoney(g, u, 2000, "initial", "Test");
    s.setLevel(g, u, 10);
    s.cacheMessage({
      id: "m1",
      guild_id: g,
      channel_id: "c1",
      user_id: u,
      name: "Test",
      avatar: "",
      content: "Wiadomość zachowana po restarcie",
      attachments: "[]",
      timestamp: time,
    });
    s.addCase(g, u, "owner", "warn", "Test");
    s.enqueueLog("logs", { embeds: [] });
    s.close();
    s = new Store(path);
    assert.equal(s.profile(g, u).balance, 2000);
    assert.equal(s.profile(g, u).xp, 15000);
    assert.equal(s.message("m1")?.content, "Wiadomość zachowana po restarcie");
    assert.equal(s.cases(g, u).length, 1);
    assert.equal(
      (
        s.db.prepare("SELECT COUNT(*) AS n FROM log_outbox").get() as {
          n: number;
        }
      ).n,
      1,
    );
    s.member(g, u, false);
    assert.equal(s.top(g, "xp").length, 0);
    s.member(g, u, true);
    assert.equal(s.top(g, "xp")[0].xp, 15000);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Cofnięcie warna zachowuje historię i nie dotyczy innego serwera", () => {
  const s = new Store(":memory:");
  try {
    const id = s.addCase("guild", "user", "mod", "warn", "reason");
    assert.equal(s.revokeWarn("other-guild", id), false);
    assert.equal(s.revokeWarn("guild", id), true);
    assert.equal(s.cases("guild", "user")[0].active, 0);
    assert.equal(s.revokeWarn("guild", id), false);
  } finally {
    s.close();
  }
});
