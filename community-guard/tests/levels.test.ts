import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/services/store.js";
import {
  xpForLevel,
  levelForXp,
  isMeaningful,
  progressForXp,
} from "../src/services/levels.js";
import { config } from "../src/config.js";
import { dayKey } from "../src/utils/format.js";
const now = Date.UTC(2026, 8, 30, 12);
const g = "1540000000000000000";
const u = "1540000000000000001";
test("Granice ról i najwyższego poziomu nie przeskakują o jeden", () => {
  for (const level of [1, 5, 10, 20, 30, 50, 100]) {
    assert.equal(levelForXp(xpForLevel(level) - 1), level - 1);
    assert.equal(levelForXp(xpForLevel(level)), level);
  }
  assert.equal(levelForXp(0), 0);
  assert.equal(levelForXp(1e9), 100);
  assert.equal(progressForXp(xpForLevel(100)).ratio, 1);
  assert.equal(xpForLevel(50), 315000);
});
test("Same linki, krótkie teksty i zalew powtarzanych liter nie dają XP", () => {
  assert.equal(isMeaningful("https://example.com/dlugi-adres"), false);
  assert.equal(isMeaningful("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), false);
  assert.equal(isMeaningful("hej"), false);
  assert.equal(isMeaningful("To jest normalna wiadomość na serwerze."), true);
});
test("Cooldown, duplikaty i ponowna dostawa tego samego eventu nie dodają XP", () => {
  const s = new Store(":memory:");
  try {
    const content = "Dzisiaj rozmawiamy o naszych ulubionych grach.";
    assert.equal(s.awardXp(g, u, content, "m1", now, 16)?.gained, 16);
    assert.equal(
      s.awardXp(
        g,
        u,
        "Kolejna całkiem inna wiadomość o książkach.",
        "m2",
        now + 500,
        16,
      ),
      null,
    );
    assert.equal(s.awardXp(g, u, content, "m3", now + 100000, 16), null);
    assert.equal(
      s.awardXp(
        g,
        u,
        "Zmieniłem tekst ale identyfikator pozostał.",
        "m1",
        now + 100000,
        16,
      ),
      null,
    );
    assert.equal(s.profile(g, u).xp, 16);
  } finally {
    s.close();
  }
});
test("Limit dzienny przycina ostatnią nagrodę i odnawia się w dniu polskim", () => {
  const s = new Store(":memory:");
  try {
    s.profile(g, u);
    s.db
      .prepare(
        "UPDATE profiles SET xp_day=?,day_xp=? WHERE guild_id=? AND user_id=?",
      )
      .run(dayKey(now), config.leveling.dailyCap - 3, g, u);
    assert.equal(
      s.awardXp(
        g,
        u,
        "Dłuższa wiadomość kończąca pierwszy dzień.",
        "m1",
        now,
        16,
      )?.gained,
      3,
    );
    assert.equal(
      s.awardXp(
        g,
        u,
        "Jeszcze jedna wiadomość ponad dzienny limit.",
        "m2",
        now + 100000,
        16,
      ),
      null,
    );
    assert.equal(
      s.awardXp(
        g,
        u,
        "Zupełnie nowa treść napisana następnego dnia.",
        "m3",
        now + 86400000,
        16,
      )?.gained,
      16,
    );
    assert.equal(dayKey(Date.UTC(2026, 8, 30, 22, 5)), "2026-10-01");
  } finally {
    s.close();
  }
});
