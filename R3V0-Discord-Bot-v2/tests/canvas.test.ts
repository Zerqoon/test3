import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/services/store.js";
import { renderCard } from "../src/canvas/cards.js";
import { commandData } from "../src/commands/definitions.js";
import { rulesPanel, guidePanel, infoPanel } from "../src/commands/panels.js";
test("Wszystkie rodzaje kart renderują się bez sieci i przy maksymalnym saldzie oraz długiej nazwie", async () => {
  const s = new Store(":memory:");
  try {
    const profile = {
      ...s.profile("guild", "user", "Bardzo długi pseudonim gracza • Żółć"),
      balance: 1e12,
      xp: 1230000,
      messages: 100000,
      title: "legenda",
    };
    for (const kind of [
      "rank",
      "profile",
      "levelup",
      "wallet",
      "welcome",
    ] as const) {
      const png = await renderCard({ kind, profile, rank: 10000 });
      assert.equal(png.subarray(1, 4).toString(), "PNG");
      assert.equal(png.readUInt32BE(16), 1200);
      assert.ok(png.length > 10000);
    }
  } finally {
    s.close();
  }
});
test("Definicje komend i panele mieszczą się w limitach Discord", () => {
  assert.equal(commandData.length, 19);
  assert.ok(commandData.some((c) => c.name === "setup-regulamin"));
  for (const c of commandData) {
    assert.ok(c.name.length <= 32);
    assert.ok(c.description.length <= 100);
  }
  for (const p of [rulesPanel(), guidePanel(), infoPanel()]) {
    const e = p.embeds[0].toJSON();
    assert.ok((e.description?.length ?? 0) <= 4096);
    const total =
      (e.title?.length ?? 0) +
      (e.description?.length ?? 0) +
      (e.footer?.text.length ?? 0) +
      (e.fields?.reduce((n, f) => n + f.name.length + f.value.length, 0) ?? 0);
    assert.ok(total <= 6000);
  }
});
