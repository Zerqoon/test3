import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/services/store.js";
import { config } from "../src/config.js";
const now = Date.UTC(2026, 8, 30, 12);
const g = "1540000000000000000";
const a = "1540000000000000001";
const b = "1540000000000000002";
test("Wypłata jest idempotentna, a nowa praca respektuje cooldown", () => {
  const s = new Store(":memory:");
  try {
    const first = s.work(g, a, "work1", now, 100);
    assert.deepEqual(s.work(g, a, "work1", now, 100), first);
    assert.equal(s.profile(g, a).balance, 100);
    assert.throws(
      () => s.work(g, a, "work2", now + 1000, 100),
      /Następna praca/,
    );
    assert.equal(s.history(g, a).length, 1);
    s.work(g, a, "work3", now + 3600000, 100);
    assert.equal(s.profile(g, a).balance, 200);
  } finally {
    s.close();
  }
});
test("Przelew jest atomowy, pobiera podatek i nie wykonuje się drugi raz", () => {
  const s = new Store(":memory:");
  try {
    s.adjustMoney(g, a, 1000, "funds", "Test", now);
    const result = s.transfer(g, a, b, 100, "pay", now);
    assert.equal(result.fee, 3);
    assert.equal(s.profile(g, a).balance, 897);
    assert.equal(s.profile(g, b).balance, 100);
    s.transfer(g, a, b, 100, "pay", now);
    assert.equal(s.profile(g, b).balance, 100);
    assert.throws(
      () => s.transfer(g, a, b, 1000, "tooMuch", now),
      /wystarczającej/,
    );
    assert.equal(s.profile(g, a).balance, 897);
    assert.equal(s.profile(g, b).balance, 100);
  } finally {
    s.close();
  }
});
test("Przepełnienie konta odbiorcy wycofuje obciążenie nadawcy i wpisy historii", () => {
  const s = new Store(":memory:");
  try {
    s.adjustMoney(g, a, 1000, "funds", "Test", now);
    s.profile(g, b);
    s.db
      .prepare("UPDATE profiles SET balance=? WHERE guild_id=? AND user_id=?")
      .run(config.economy.maxBalance, g, b);
    assert.throws(
      () => s.transfer(g, a, b, 100, "overflow", now),
      /maksymalne/,
    );
    assert.equal(s.profile(g, a).balance, 1000);
    assert.equal(s.history(g, a).length, 1);
    assert.equal(s.history(g, b).length, 0);
  } finally {
    s.close();
  }
});
test("Daily ma 24h odstępu, zwiększa serię i resetuje ją po przerwie", () => {
  const s = new Store(":memory:");
  try {
    assert.equal(s.daily(g, a, "d1", now).gain, 250);
    assert.throws(
      () => s.daily(g, a, "early", now + 86399999),
      /Nagroda dzienna/,
    );
    assert.equal(s.daily(g, a, "d2", now + 86400000).gain, 275);
    assert.equal(s.daily(g, a, "d3", now + 4 * 86400000).streak, 1);
  } finally {
    s.close();
  }
});
test("Zakup boostera jest atomowy, idempotentny i odrzuca brak środków", () => {
  const s = new Store(":memory:");
  try {
    assert.throws(() => s.buy(g, a, "xp-5-1440", "poor", now));
    assert.equal(s.inventory(g, a).length, 0);
    s.adjustMoney(g, a, 10000, "funds", "Test", now);
    const first = s.buy(g, a, "xp-2-60", "buy1", now);
    assert.equal(first.balance, 6400);
    assert.deepEqual(s.buy(g, a, "xp-2-60", "buy1", now), first);
    assert.equal(s.inventory(g, a)[0].quantity, 1);
    assert.throws(() => s.buy(g, a, "xp-5-1440", "poor2", now));
    assert.equal(s.profile(g, a).balance, 6400);
  } finally {
    s.close();
  }
});
test("Booster zużywa się raz, obejmuje tekst i voice, wygasa i nie zwiększa wypłaty", () => {
  const s = new Store(":memory:");
  try {
    s.adjustMoney(g, a, 10000, "funds", "Test", now);
    s.buy(g, a, "xp-2-5", "buy1", now);
    s.buy(g, a, "xp-2-5", "buy2", now);
    const used = s.use(g, a, "xp-2-5", "use1", now);
    assert.deepEqual(s.use(g, a, "xp-2-5", "use1", now), used);
    assert.equal(s.inventory(g, a)[0].quantity, 1);
    assert.throws(() => s.use(g, a, "xp-2-5", "use2", now), /już działa/);
    assert.equal(s.work(g, a, "work1", now, 100).gain, 100);
    assert.equal(
      s.awardXp(
        g,
        a,
        "Normalna wiadomość podczas boostera.",
        "m1",
        now,
        10,
        1.5,
      )?.gained,
      30,
    );
    assert.equal(s.awardVoiceXp(g, a, "v1", now, 8, 1.5)?.gained, 24);
    assert.equal(s.awardVoiceXp(g, a, "v2", now + 300000, 8, 1.5)?.gained, 12);
    assert.equal(s.profile(g, a).xp, 66);
    assert.equal(s.inventory(g, a)[0].quantity, 1);
  } finally {
    s.close();
  }
});
test("Odrzuca ułamki, przelewy do siebie i ujemne saldo", () => {
  const s = new Store(":memory:");
  try {
    assert.throws(() => s.transfer(g, a, a, 1, "self", now));
    assert.throws(() => s.transfer(g, a, b, 1.5, "float", now));
    assert.throws(() => s.transfer(g, a, b, -50, "negative", now));
    assert.throws(() =>
      s.adjustMoney(g, a, -1, "negativeBalance", "Test", now),
    );
  } finally {
    s.close();
  }
});
