import { describe, expect, it } from 'vitest';
import { legacyClanSchema } from '../src/api/schemas.js';
import { normalizeClan } from '../src/services/ClanNormalizer.js';

const realR3V0 = {
  Created: 1789457781,
  Owner: 1308591016,
  Name: 'R3V0',
  Icon: 'rbxassetid://117774384827236',
  Desc: 'R3V0 Clan',
  CountryCode: 'PL',
  MemberCapacity: 70,
  OfficerCapacity: 8,
  GuildLevel: 6,
  Members: [
    { UserID: 178561454, PermissionLevel: 50, JoinTime: 1789829166 },
    { UserID: 2819770913, PermissionLevel: 50, JoinTime: 1789835336 }
  ],
  DepositedDiamonds: 867100000,
  DiamondContributions: {
    AllTime: {
      Sum: 1500000000,
      Data: [{ UserID: 1308591016, Diamonds: 1500000000 }]
    }
  },
  IconChangeTimestamp: 1789828950,
  Battles: {
    SpaceMineBattle2026: {
      ProcessedAwards: false,
      AwardUserIDs: [],
      BattleID: 'SpaceMineBattle2026',
      Points: 42075048,
      PointContributions: [
        { UserID: 178561454, Points: 300858 },
        { UserID: 1308591016, Points: 39799161 },
        { UserID: 2819770913, Points: 1975029 }
      ],
      Place: 2499
    }
  }
};

describe('ClanNormalizer real R3V0 payload', () => {
  it('reads active battle directly from Battles map', () => {
    const raw = legacyClanSchema.parse(realR3V0);
    const clan = normalizeClan(raw, 1000);
    expect(clan.battleId).toBe('SpaceMineBattle2026');
    expect(clan.battlePoints).toBe(42075048);
    expect(clan.battlePlace).toBe(2499);
  });

  it('injects owner even though owner is not in Members', () => {
    const clan = normalizeClan(legacyClanSchema.parse(realR3V0));
    expect(clan.members).toHaveLength(3);
    const owner = clan.members.find(member => member.userId === 1308591016)!;
    expect(owner.isOwner).toBe(true);
    expect(owner.permissionLevel).toBe(100);
    expect(owner.battlePoints).toBe(39799161);
    expect(owner.diamonds).toBe(1500000000);
  });

  it('maps points and zero diamond fallbacks for every member', () => {
    const clan = normalizeClan(legacyClanSchema.parse(realR3V0));
    expect(clan.members.find(member => member.userId === 178561454)?.battlePoints).toBe(300858);
    expect(clan.members.find(member => member.userId === 178561454)?.diamonds).toBe(0);
    expect(clan.members.find(member => member.userId === 2819770913)?.battlePoints).toBe(1975029);
    expect(clan.members.find(member => member.userId === 2819770913)?.diamonds).toBe(0);
  });

  it('uses zero values when there is no active battle', () => {
    const raw = legacyClanSchema.parse({
      Name: 'OFF',
      Owner: 1,
      Members: [{ UserID: 2, PermissionLevel: 50 }],
      Battles: null
    });
    const clan = normalizeClan(raw);
    expect(clan.battleId).toBeNull();
    expect(clan.battlePoints).toBe(0);
    expect(clan.members.map(member => member.battlePoints)).toEqual([0, 0]);
  });
});
