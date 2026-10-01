import { mkdir, writeFile } from "node:fs/promises";
import { renderCard } from "../src/canvas/cards.js";
import { Store } from "../src/services/store.js";
import { xpForLevel } from "../src/services/levels.js";
import { dayKey } from "../src/utils/format.js";
const store = new Store(":memory:");
const profile = {
  ...store.profile(
    "1540000000000000000",
    "1540000000000000001",
    "Zerqon (@b3sttiee)",
  ),
  xp: xpForLevel(20) + 2200,
  balance: 12450,
  messages: 4217,
  streak: 5,
  text_xp: 32180,
  voice_xp: 24020,
  voice_seconds: 240200,
  day_base_xp: 746,
  xp_boost_multiplier: 5,
  xp_boost_until: Date.now() + 86400000,
  xp_day: dayKey(Date.now()),
  day_xp: 456,
};
await mkdir("previews", { recursive: true });
for (const kind of [
  "rank",
  "profile",
  "levelup",
  "wallet",
  "welcome",
] as const) {
  const png = await renderCard({
    kind,
    profile,
    robloxName: "B3sttiee",
    boostMultiplier: 7.5,
    rank: 3,
    reward: kind === "wallet" ? 325 : undefined,
    memberCount: 1248,
    subtitle: kind === "levelup" ? "Odblokowano: Dostęp do GIF-ów" : undefined,
  });
  await writeFile(`previews/${kind}.png`, png);
}
store.close();
console.log(
  "Podglądy zapisano w previews/. Avatar na serwerze pochodzi z konta sprawdzanej osoby.",
);
