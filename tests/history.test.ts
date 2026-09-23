import { describe, expect, it } from 'vitest';
import { stats } from '../src/services/HistoryService.js';

describe('history stats', () => {
  it('returns zero deltas for one snapshot', () => {
    const result = stats([{ ts: Date.now(), value: 39_799_161 }]);
    expect(result.current).toBe(39_799_161);
    expect(result.gain24h).toBe(0);
    expect(result.deltaPct24h).toBe(0);
    expect(result.gain1h).toBe(0);
    expect(result.firstSnapshotOnly).toBe(true);
  });

  it('uses oldest and newest 24h points for delta', () => {
    const now = Date.now();
    const result = stats([
      { ts: now - 23 * 3_600_000, value: 10_000_000 },
      { ts: now - 12 * 3_600_000, value: 20_000_000 },
      { ts: now, value: 42_000_000 }
    ]);
    expect(result.gain24h).toBe(32_000_000);
    expect(result.deltaPct24h).toBeCloseTo(320);
  });

  it('starts a new series after a points reset', () => {
    const now = Date.now();
    const result = stats([
      { ts: now - 3_600_000, value: 1000 },
      { ts: now - 1800_000, value: 25 },
      { ts: now, value: 50 }
    ]);
    expect(result.start).toBe(25);
    expect(result.current).toBe(50);
    expect(result.gain24h).toBe(25);
  });
});
