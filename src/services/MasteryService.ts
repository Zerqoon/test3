export interface MasteryItemMethod {
  name: string;
  xpEach: number;
  amountNeeded: number;
  estGemCost?: number;
}

export interface MasteryActionGroup {
  actionName: string;
  items: MasteryItemMethod[];
}

export interface MasteryCalcResult {
  id: string;
  title: string;
  color: number;
  iconUrl: string;
  startLevel: number;
  endLevel: number;
  hasClanBoost: boolean;
  rawXp: number;
  totalXpRequired: number;
  groups: MasteryActionGroup[];
  infoNotes?: string;
}

// Skumulowany XP od poziomu 1 do targetLvl w PS99 (max 13,206,118.2 na lvl 99)
function getCumulativeXp(lvl: number): number {
  if (lvl <= 1) return 0;
  if (lvl >= 99) return 13_206_118.2;
  return Math.pow((lvl - 1) / 98, 2.82) * 13_206_118.2;
}

export class MasteryService {
  calculate(
    type: string,
    startLevel: number,
    endLevel: number,
    clanBoost = true
  ): MasteryCalcResult {
    const startXp = getCumulativeXp(startLevel);
    const endXp = getCumulativeXp(endLevel);
    const rawXp = Math.max(0, endXp - startXp);
    const totalXp = clanBoost ? rawXp * 0.9 : rawXp;

    const calcAmount = (xpPerAction: number) => Math.ceil(totalXp / xpPerAction);

    switch (type) {
      // 1. FRUIT MASTERY
      case 'fruit': {
        const eatAny = calcAmount(20);
        const eatRainbow = calcAmount(50);
        return {
          id: 'fruit',
          title: '🍎 Fruit Mastery Info',
          color: 0xEE1515,
          iconUrl: 'https://biggamesapi.io/image/8422409748',
          startLevel,
          endLevel,
          hasClanBoost: clanBoost,
          rawXp,
          totalXpRequired: totalXp,
          groups: [
            {
              actionName: 'Eat',
              items: [
                { name: 'Any fruit (including shiny)', xpEach: 20, amountNeeded: eatAny, estGemCost: eatAny * 2500 },
                { name: 'Rainbow Fruit', xpEach: 50, amountNeeded: eatRainbow, estGemCost: eatRainbow * 22000 }
              ]
            },
            {
              actionName: 'Crafting',
              items: [
                { name: 'Rainbow Fruit (Craft)', xpEach: 30, amountNeeded: calcAmount(30) },
                { name: 'Shiny Fruit (Craft)', xpEach: 90, amountNeeded: calcAmount(90) }
              ]
            }
          ]
        };
      }

      // 2. POTION MASTERY
      case 'potions': {
        const t1ToT2 = calcAmount(10);
        const t2ToT3 = calcAmount(25);
        const t3ToT4 = calcAmount(60);
        const t4ToT5 = calcAmount(140);
        return {
          id: 'potions',
          title: '🧪 Potion Mastery Info',
          color: 0x3B82F6,
          iconUrl: 'https://biggamesapi.io/image/8422410112',
          startLevel,
          endLevel,
          hasClanBoost: clanBoost,
          rawXp,
          totalXpRequired: totalXp,
          groups: [
            {
              actionName: 'Upgrade Potions (Craft)',
              items: [
                { name: 'Tier 1 ➔ Tier 2', xpEach: 10, amountNeeded: t1ToT2, estGemCost: t1ToT2 * 4 * 600 },
                { name: 'Tier 2 ➔ Tier 3', xpEach: 25, amountNeeded: t2ToT3, estGemCost: t2ToT3 * 4 * 1800 },
                { name: 'Tier 3 ➔ Tier 4', xpEach: 60, amountNeeded: t3ToT4, estGemCost: t3ToT4 * 4 * 5000 },
                { name: 'Tier 4 ➔ Tier 5', xpEach: 140, amountNeeded: t4ToT5, estGemCost: t4ToT5 * 4 * 15000 }
              ]
            },
            {
              actionName: 'Drink Potions',
              items: [
                { name: 'Any Tier 1 Potion', xpEach: 15, amountNeeded: calcAmount(15) },
                { name: 'Any Tier 5+ Potion', xpEach: 100, amountNeeded: calcAmount(100) }
              ]
            }
          ],
          infoNotes: 'Najszybsza metoda: automatyczny upgrade mikstur Tier 1/2 przy użyciu Potion Machine.'
        };
      }

      // 3. ENCHANT MASTERY
      case 'enchants': {
        const e1ToE2 = calcAmount(10);
        const e2ToE3 = calcAmount(25);
        const e3ToE4 = calcAmount(70);
        const e4ToE5 = calcAmount(160);
        return {
          id: 'enchants',
          title: '📖 Enchant Mastery Info',
          color: 0x8B5CF6,
          iconUrl: 'https://biggamesapi.io/image/8422410425',
          startLevel,
          endLevel,
          hasClanBoost: clanBoost,
          rawXp,
          totalXpRequired: totalXp,
          groups: [
            {
              actionName: 'Upgrade Books (Enchant Machine)',
              items: [
                { name: 'Tier 1 ➔ Tier 2 Book', xpEach: 10, amountNeeded: e1ToE2, estGemCost: e1ToE2 * 5 * 800 },
                { name: 'Tier 2 ➔ Tier 3 Book', xpEach: 25, amountNeeded: e2ToE3, estGemCost: e2ToE3 * 5 * 2500 },
                { name: 'Tier 3 ➔ Tier 4 Book', xpEach: 70, amountNeeded: e3ToE4, estGemCost: e3ToE4 * 5 * 8000 },
                { name: 'Tier 4 ➔ Tier 5 Book', xpEach: 160, amountNeeded: e4ToE5, estGemCost: e4ToE5 * 5 * 25000 }
              ]
            }
          ],
          infoNotes: 'Kupowanie tanich ksiąg Tier 1 na rynku i ich łączenie to najtańszy sposób na wbicie 99 lvl.'
        };
      }

      // 4. KEYS MASTERY
      case 'keys': {
        const crystalKeys = calcAmount(50);
        const secretKeys = calcAmount(75);
        const techKeys = calcAmount(100);
        const voidKeys = calcAmount(150);
        return {
          id: 'keys',
          title: '🗝️ Key Mastery Info',
          color: 0xF59E0B,
          iconUrl: 'https://biggamesapi.io/image/8422410884',
          startLevel,
          endLevel,
          hasClanBoost: clanBoost,
          rawXp,
          totalXpRequired: totalXp,
          groups: [
            {
              actionName: 'Combine Key Halves (Upper + Lower)',
              items: [
                { name: 'Crystal Key', xpEach: 50, amountNeeded: crystalKeys, estGemCost: crystalKeys * 18000 },
                { name: 'Secret Key', xpEach: 75, amountNeeded: secretKeys, estGemCost: secretKeys * 45000 },
                { name: 'Tech Key', xpEach: 100, amountNeeded: techKeys, estGemCost: techKeys * 65000 },
                { name: 'Void Key', xpEach: 150, amountNeeded: voidKeys, estGemCost: voidKeys * 110000 }
              ]
            },
            {
              actionName: 'Unlock Chests',
              items: [
                { name: 'Otwarcie Crystal Chest', xpEach: 100, amountNeeded: calcAmount(100) },
                { name: 'Otwarcie Tech Chest', xpEach: 200, amountNeeded: calcAmount(200) },
                { name: 'Otwarcie Void Chest', xpEach: 350, amountNeeded: calcAmount(350) }
              ]
            }
          ]
        };
      }

      // 5. EGGS MASTERY
      case 'eggs': {
        return {
          id: 'eggs',
          title: '🥚 Egg Mastery Info',
          color: 0x10B981,
          iconUrl: 'https://biggamesapi.io/image/8422411210',
          startLevel,
          endLevel,
          hasClanBoost: clanBoost,
          rawXp,
          totalXpRequired: totalXp,
          groups: [
            {
              actionName: 'Hatching Eggs',
              items: [
                { name: 'Normalny Egg', xpEach: 10, amountNeeded: calcAmount(10) },
                { name: 'Golden Egg (Hatch)', xpEach: 25, amountNeeded: calcAmount(25) },
                { name: 'Charged Egg (Hatch)', xpEach: 50, amountNeeded: calcAmount(50) }
              ]
            }
          ],
          infoNotes: 'Otwieranie jajek z włączonym Auto-Hatch na Spawn Egg (najtańszy egg za monety).'
        };
      }

      // 6. PETS & FUSING
      case 'fusing': {
        return {
          id: 'fusing',
          title: '🧬 Pet & Fusing Mastery Info',
          color: 0xEC4899,
          iconUrl: 'https://biggamesapi.io/image/8422411550',
          startLevel,
          endLevel,
          hasClanBoost: clanBoost,
          rawXp,
          totalXpRequired: totalXp,
          groups: [
            {
              actionName: 'Pet Machine Actions',
              items: [
                { name: 'Stworzenie Golden Peta', xpEach: 20, amountNeeded: calcAmount(20) },
                { name: 'Stworzenie Rainbow Peta', xpEach: 60, amountNeeded: calcAmount(60) },
                { name: 'Fuzja w Fuse Machine (3 pety)', xpEach: 40, amountNeeded: calcAmount(40) }
              ]
            }
          ]
        };
      }

      // 7. BREAKABLES
      case 'breakables': {
        return {
          id: 'breakables',
          title: '📦 Breakables Mastery Info',
          color: 0x64748B,
          iconUrl: 'https://biggamesapi.io/image/8422411990',
          startLevel,
          endLevel,
          hasClanBoost: clanBoost,
          rawXp,
          totalXpRequired: totalXp,
          groups: [
            {
              actionName: 'Niszczenie obiektów na mapie',
              items: [
                { name: 'Monety / Pieniądze / Małe skrzynki', xpEach: 2, amountNeeded: calcAmount(2) },
                { name: 'Diamentowe rudy / Vaults', xpEach: 25, amountNeeded: calcAmount(25) },
                { name: 'Gigantyczne Skrzynie (Giant Chests)', xpEach: 250, amountNeeded: calcAmount(250) }
              ]
            }
          ]
        };
      }

      // 8. DAYCARE
      case 'daycare': {
        return {
          id: 'daycare',
          title: '☀️ Daycare Mastery Info',
          color: 0xFBBF24,
          iconUrl: 'https://biggamesapi.io/image/8422412330',
          startLevel,
          endLevel,
          hasClanBoost: clanBoost,
          rawXp,
          totalXpRequired: totalXp,
          groups: [
            {
              actionName: 'Odbiór z Przedszkola (Daycare Claims)',
              items: [
                { name: 'Standardowy Daycare (1 pet)', xpEach: 250, amountNeeded: calcAmount(250) },
                { name: 'Exclusive Daycare (1 pet)', xpEach: 1200, amountNeeded: calcAmount(1200) }
              ]
            }
          ]
        };
      }

      // 9. FISHING & DIGGING
      case 'fishing':
      default: {
        return {
          id: 'fishing',
          title: '🎣 Fishing Mastery Info',
          color: 0x06B6D4,
          iconUrl: 'https://biggamesapi.io/image/8422412770',
          startLevel,
          endLevel,
          hasClanBoost: clanBoost,
          rawXp,
          totalXpRequired: totalXp,
          groups: [
            {
              actionName: 'Złowione ryby / skarby',
              items: [
                { name: 'Zwykła ryba', xpEach: 20, amountNeeded: calcAmount(20) },
                { name: 'Rzadka ryba / Shard', xpEach: 75, amountNeeded: calcAmount(75) },
                { name: 'Skrzynia / Corny / Magic Shard', xpEach: 250, amountNeeded: calcAmount(250) }
              ]
            }
          ]
        };
      }
    }
  }
}

export const masteryService = new MasteryService();
