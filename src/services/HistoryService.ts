import { historyRepo } from '../database/repositories.js';
import type { ClanRecord, HistoryPoint } from '../types.js';

export interface HistoryStats {
  current: number;
  start: number;
  gain1h: number;
  gain24h: number;
  deltaPct24h: number;
  avgPerHour: number;
  bestPerHour: number;
  latestPerHour: number;
  hourlyPoints: number[]; // Dokładnie 24 godzinowe delty pod wykres Hourly Performance
  points: HistoryPoint[];
  ratePoints: HistoryPoint[];
  firstSnapshotOnly: boolean;
}

export interface CaptureResult {
  clanSnapshotId: number;
  playerSnapshotsInserted: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Usuwa zafałszowane punkty sprzed resetu wojny klanowej (gdy punkty spadły)
 */
function cleanSeries(points: HistoryPoint[]): HistoryPoint[] {
  if (points.length < 2) return points;

  let startIndex = 0;
  for (let index = 1; index < points.length; index++) {
    if (points[index]!.value < points[index - 1]!.value) {
      startIndex = index;
    }
  }

  return points.slice(startIndex);
}

/**
 * Szacuje wartość punktów w dowolnym punkcie w czasie za pomocą interpolacji liniowej
 */
function getEstimatedValueAt(points: HistoryPoint[], targetTs: number): number {
  if (!points.length) return 0;
  if (targetTs <= points[0]!.ts) return points[0]!.value;
  if (targetTs >= points.at(-1)!.ts) return points.at(-1)!.value;

  let prev = points[0]!;
  for (let i = 1; i < points.length; i++) {
    const cur = points[i]!;
    if (cur.ts >= targetTs) {
      if (cur.ts === prev.ts) return cur.value;
      const progress = (targetTs - prev.ts) / (cur.ts - prev.ts);
      return prev.value + (cur.value - prev.value) * progress;
    }
    prev = cur;
  }

  return points.at(-1)!.value;
}

export function stats(input: HistoryPoint[]): HistoryStats {
  const points = cleanSeries(
    input
      .filter(point => Number.isFinite(point.ts) && Number.isFinite(point.value))
      .map(point => ({ ts: Number(point.ts), value: Math.max(0, Number(point.value)) }))
      .sort((a, b) => a.ts - b.ts)
  );

  if (!points.length) {
    return {
      current: 0,
      start: 0,
      gain1h: 0,
      gain24h: 0,
      deltaPct24h: 0,
      avgPerHour: 0,
      bestPerHour: 0,
      latestPerHour: 0,
      hourlyPoints: new Array(24).fill(0),
      points: [],
      ratePoints: [],
      firstSnapshotOnly: false
    };
  }

  const now = Date.now();
  const first = points[0]!;
  const last = points.at(-1)!;
  const firstSnapshotOnly = points.length === 1;

  // Wartość bazowa sprzed 24h
  const val24hAgo = getEstimatedValueAt(points, now - DAY_MS);
  const startVal = first.ts > now - DAY_MS ? first.value : val24hAgo;

  // Przyrost 24h oraz 1h
  const gain24h = firstSnapshotOnly ? 0 : Math.max(0, last.value - startVal);
  const val1hAgo = getEstimatedValueAt(points, now - HOUR_MS);
  const gain1h = firstSnapshotOnly ? 0 : Math.max(0, last.value - val1hAgo);
  const deltaPct24h = startVal > 0 ? (gain24h / startVal) * 100 : 0;

  // 1. Obliczenie 24 godzinowych koszyków (Hourly Performance)
  const hourlyPoints = new Array<number>(24).fill(0);

  if (!firstSnapshotOnly) {
    for (let i = 0; i < 24; i++) {
      const slotStart = now - (24 - i) * HOUR_MS;
      const slotEnd = now - (23 - i) * HOUR_MS;

      // Jeśli dany przedział czasu był przed rozpoczęciem monitoringu, przyrost wynosi 0
      if (slotEnd < first.ts) {
        hourlyPoints[i] = 0;
        continue;
      }

      const vStart = getEstimatedValueAt(points, slotStart);
      const vEnd = getEstimatedValueAt(points, slotEnd);
      hourlyPoints[i] = Math.max(0, Math.round(vEnd - vStart));
    }
  }

  // 2. Metryki godzinowe zgodne z UI referencyjnym
  const latestPerHour = hourlyPoints[23] ?? gain1h;
  const bestPerHour = hourlyPoints.length ? Math.max(...hourlyPoints) : 0;
  // Średnia na godzinę = zysk z 24h podzielony przez 24 godziny
  const avgPerHour = Math.round(gain24h / 24);

  // Kompatybilność wsteczna z ratePoints
  const ratePoints: HistoryPoint[] = [];
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const elapsedHours = (current.ts - previous.ts) / HOUR_MS;

    if (elapsedHours <= 0 || elapsedHours > 2) continue;
    const gain = Math.max(0, current.value - previous.value);
    ratePoints.push({ ts: current.ts, value: Math.round(gain / elapsedHours) });
  }

  return {
    current: last.value,
    start: startVal,
    gain1h,
    gain24h,
    deltaPct24h,
    avgPerHour,
    bestPerHour,
    latestPerHour,
    hourlyPoints,
    points,
    ratePoints,
    firstSnapshotOnly
  };
}

export class HistoryService {
  captureClan(clan: ClanRecord): CaptureResult {
    const timestamp = clan.fetchedAt || Date.now();
    const clanSnapshotId = historyRepo.saveClanSnapshot({
      timestamp,
      clanName: clan.name,
      points: clan.battlePoints,
      place: clan.battlePlace ?? 0,
      diamonds: clan.depositedDiamonds
    });

    const playerSnapshotsInserted = historyRepo.savePlayerSnapshots(
      clan.members.map(member => ({
        userId: member.userId,
        battleId: clan.battleId ?? '',
        points: member.battlePoints,
        diamonds: member.diamonds
      })),
      clan.name,
      timestamp
    );

    return { clanSnapshotId, playerSnapshotsInserted };
  }

  clan24h(clanName: string): HistoryStats {
    const rows = historyRepo.get24hClanHistory(clanName);
    return stats(rows.map(row => ({ ts: row.timestamp, value: row.points })));
  }

  player24h(userId: number, battleId?: string | null): HistoryStats {
    const rows = historyRepo.get24hPlayerHistory(userId, battleId || undefined);
    return stats(rows.map(row => ({ ts: row.timestamp, value: row.points })));
  }

  clan(clanName: string, hours: number): HistoryStats {
    const since = Date.now() - Math.max(1, hours) * HOUR_MS;
    const rows = historyRepo.getClanHistory(clanName, since);
    return stats(rows.map(row => ({ ts: row.timestamp, value: row.points })));
  }

  player(userId: number, hours: number, battleId?: string | null): HistoryStats {
    const since = Date.now() - Math.max(1, hours) * HOUR_MS;
    const rows = historyRepo.getPlayerHistory(userId, since, battleId || undefined);
    return stats(rows.map(row => ({ ts: row.timestamp, value: row.points })));
  }
}
