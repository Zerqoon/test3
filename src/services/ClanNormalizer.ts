import type { LegacyClan, ClanBattle } from '../api/schemas.js';
import type { ClanMember, ClanRecord } from '../types.js';

function resolveActiveBattle(
  battles?: Record<string, ClanBattle> | null,
  globalActiveBattleId?: string | null
): { id: string | null; battle: ClanBattle | null } {
  if (!battles || typeof battles !== 'object') {
    return { id: globalActiveBattleId ?? null, battle: null };
  }

  if (globalActiveBattleId) {
    if (battles[globalActiveBattleId]) {
      return {
        id: battles[globalActiveBattleId].BattleID ?? globalActiveBattleId,
        battle: battles[globalActiveBattleId]
      };
    }
    return { id: globalActiveBattleId, battle: null };
  }

  const entries = Object.entries(battles);
  if (!entries.length) {
    return { id: null, battle: null };
  }

  const reversed = [...entries].reverse();
  const latestOngoing = reversed.find(([, b]) => b.ProcessedAwards === false);
  if (latestOngoing) {
    return {
      id: latestOngoing[1].BattleID ?? latestOngoing[0],
      battle: latestOngoing[1]
    };
  }

  const last = entries[entries.length - 1]!;
  return {
    id: last[1].BattleID ?? last[0],
    battle: last[1]
  };
}

export function normalizeClan(
  raw: LegacyClan,
  fetchedAt = Date.now(),
  globalActiveBattleId?: string | null
): ClanRecord {
  const { id: battleId, battle: activeBattle } = resolveActiveBattle(raw.Battles, globalActiveBattleId);

  const battlePointsByUser = new Map<number, number>();
  for (const row of activeBattle?.PointContributions ?? []) {
    const userId = Number(row.UserID);
    const points = Number(row.Points);
    if (Number.isFinite(userId) && Number.isFinite(points)) {
      battlePointsByUser.set(userId, points);
    }
  }

  const diamondsByUser = new Map<number, number>();
  for (const row of raw.DiamondContributions?.AllTime?.Data ?? []) {
    const userId = Number(row.UserID);
    const diamonds = Number(row.Diamonds);
    if (Number.isFinite(userId) && Number.isFinite(diamonds)) {
      diamondsByUser.set(userId, diamonds);
    }
  }

  const ownerId = raw.Owner != null && Number.isFinite(Number(raw.Owner)) ? Number(raw.Owner) : null;
  const byId = new Map<number, ClanMember>();

  for (const member of raw.Members ?? []) {
    const userId = Number(member.UserID);
    if (!Number.isFinite(userId)) continue;

    byId.set(userId, {
      userId,
      permissionLevel: Number(member.PermissionLevel ?? 0),
      joinTime: member.JoinTime == null ? null : Number(member.JoinTime),
      isOwner: ownerId === userId,
      battlePoints: battlePointsByUser.get(userId) ?? 0,
      diamonds: diamondsByUser.get(userId) ?? 0
    });
  }

  if (ownerId != null) {
    const existing = byId.get(ownerId);
    byId.set(ownerId, {
      userId: ownerId,
      permissionLevel: 100,
      joinTime: existing?.joinTime ?? null,
      isOwner: true,
      battlePoints: battlePointsByUser.get(ownerId) ?? existing?.battlePoints ?? 0,
      diamonds: diamondsByUser.get(ownerId) ?? existing?.diamonds ?? 0
    });
  }

  for (const [userId, points] of battlePointsByUser) {
    if (byId.has(userId)) continue;
    byId.set(userId, {
      userId,
      permissionLevel: ownerId === userId ? 100 : 0,
      joinTime: null,
      isOwner: ownerId === userId,
      battlePoints: points,
      diamonds: diamondsByUser.get(userId) ?? 0
    });
  }

  const contributedPoints = [...battlePointsByUser.values()].reduce((sum, value) => sum + value, 0);

  return {
    name: raw.Name,
    ownerId,
    icon: raw.Icon ?? null,
    description: raw.Desc ?? null,
    memberCapacity: Number(raw.MemberCapacity ?? 0),
    officerCapacity: Number(raw.OfficerCapacity ?? 0),
    guildLevel: Number(raw.GuildLevel ?? 0),
    countryCode: raw.CountryCode ?? null,
    depositedDiamonds: Number(raw.DepositedDiamonds ?? 0),
    bronzeMedals: Number(raw.BronzeMedals ?? 0),
    silverMedals: Number(raw.SilverMedals ?? 0),
    goldMedals: Number(raw.GoldMedals ?? 0),
    members: [...byId.values()].sort((a, b) => {
      if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
      if (b.permissionLevel !== a.permissionLevel) return b.permissionLevel - a.permissionLevel;
      return b.battlePoints - a.battlePoints;
    }),
    battleId: battleId ?? 'Brak bitwy',
    battlePoints: Number(activeBattle?.Points ?? (activeBattle ? contributedPoints : 0)),
    battlePlace: activeBattle?.Place == null ? null : Number(activeBattle.Place),
    fetchedAt
  };
}

export const ClanNormalizer = {
  normalize: normalizeClan
};

export default normalizeClan;
