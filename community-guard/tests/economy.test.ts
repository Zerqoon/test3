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
test("Sklep i ekwipunek nie zabierają waluty przy nieudanym zakupie", () => {
  const s = new Store(":memory:");
  try {
    assert.throws(() => s.buy(g, a, "odkrywca", "poor", now));
    assert.equal(s.inventory(g, a).length, 0);
    s.adjustMoney(g, a, 10000, "funds", "Test", now);
    s.buy(g, a, "odkrywca", "buy1", now);
    assert.equal(s.profile(g, a).balance, 7500);
    assert.throws(() => s.buy(g, a, "odkrywca", "buy2", now), /już posiadasz/);
    assert.equal(s.profile(g, a).balance, 7500);
    s.use(g, a, "odkrywca", "equip", now);
    assert.equal(s.profile(g, a).title, "odkrywca");
  } finally {
    s.close();
  }
});
test("Eliksir zużywa się raz, zwiększa pracę i nie wpływa na XP", () => {
  const s = new Store(":memory:");
  try {
    s.adjustMoney(g, a, 5000, "funds", "Test", now);
    s.buy(g, a, "wydajnosc", "buy1", now);
    s.buy(g, a, "wydajnosc", "buy2", now);
    s.use(g, a, "wydajnosc", "use1", now);
    s.use(g, a, "wydajnosc", "use1", now);
    assert.equal(s.inventory(g, a)[0].quantity, 1);
    assert.throws(() => s.use(g, a, "wydajnosc", "use2", now), /już działa/);
    assert.equal(s.work(g, a, "work1", now, 100).gain, 130);
    assert.equal(s.profile(g, a).xp, 0);
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
