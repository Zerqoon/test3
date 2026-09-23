import { writeFile } from 'node:fs/promises';
import { render24hChart } from '../src/canvas/chart.js';
import { renderHistory } from '../src/canvas/renderers.js';
import { stats, type HistoryStats } from '../src/services/HistoryService.js';

const now = Date.now();
const points = Array.from({ length: 12 }, (_, index) => ({
  ts: now - (11 - index) * 300_000,
  value: 10_000_000 + index * 1_234_567
}));

const history = stats(points);
const dashboard = await renderHistory('Smoke Player', 'R3V0 • smoke test', history, null);
if (dashboard.length < 10_000) {
  throw new Error(`History canvas output too small: ${dashboard.length} bytes`);
}
await writeFile('/tmp/r3v0-history-smoke.png', dashboard);

const chart = await render24hChart({
  title: 'R3V0 • 24h smoke',
  subtitle: 'SpaceMineBattle2026 • #2499',
  current: history.current,
  delta24h: history.gain24h,
  deltaPct24h: history.deltaPct24h,
  points: history.points
});
if (chart.length < 10_000) {
  throw new Error(`24h chart output too small: ${chart.length} bytes`);
}
await writeFile('/tmp/r3v0-chart-smoke.png', chart);

const single = stats([{ ts: now, value: 39_799_161 }]);
const firstPointChart = await render24hChart({
  title: 'B3sttiee • first snapshot',
  subtitle: 'R3V0 • collecting history',
  current: single.current,
  delta24h: single.gain24h,
  deltaPct24h: single.deltaPct24h,
  points: single.points
});
if (firstPointChart.length < 10_000) {
  throw new Error(`Single-point chart output too small: ${firstPointChart.length} bytes`);
}
await writeFile('/tmp/r3v0-chart-first-point-smoke.png', firstPointChart);

const { ratePoints: _removed, ...partial } = history;
const fallback = await renderHistory(
  'Legacy Partial',
  'missing ratePoints regression path',
  partial as unknown as HistoryStats,
  null
);
if (fallback.length < 10_000) {
  throw new Error(`Partial history canvas output too small: ${fallback.length} bytes`);
}
await writeFile('/tmp/r3v0-history-partial-smoke.png', fallback);

console.log('Canvas smoke PASS', {
  dashboardBytes: dashboard.length,
  chartBytes: chart.length,
  firstPointBytes: firstPointChart.length,
  partialBytes: fallback.length
});
