import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D, type Image } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import type { HistoryStats } from '../services/HistoryService.js';
import type { RapResult } from '../services/RapService.js';
import type { HistoryPoint } from '../types.js';

// ============================================================================
// R3V0 ANALYTICS DASHBOARD ENGINE — 1:1 RECREATION
// Dark Slate, Cyan/Magenta Glows, Spline Charts & Rivals Bar
// ============================================================================

export type TimeframeMode = '30m' | '1h' | '3h' | '6h' | '12h' | '24h';

export interface ClanRivalryInfo {
  rank: number;
  totalMembers: number;
  userPoints: number;
  clanPoints: number;
  ahead?: { name: string; gap: number } | null;
  behind?: { name: string; lead: number } | null;
}

export interface ClanLeaderboardEntry { rank: number; name: string; points: number }

export interface HistoryRenderOptions {
  leaderboard?: readonly ClanLeaderboardEntry[];
  assetDirectory?: string;
  avatarRenderUrl?: string | null;
  now?: number;
  scale?: 1 | 2;
  heading?: readonly [string, string];
}

export interface PlayerCardRenderOptions extends HistoryRenderOptions {
  rank?: number | null;
  roleLabel?: string;
}

// ============================================================================
// COLOR PALETTE & STYLES (MATCHING SCREENSHOTS)
// ============================================================================

const C = {
  bgApp: '#090C12',
  bgCard: '#0F131C',
  bgSubCard: '#151A26',
  borderCard: '#1E2536',
  borderLight: 'rgba(255, 255, 255, 0.08)',
  
  // Text Colors
  textLight: '#FFFFFF',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  
  // Accents matching the 4 stat cards
  accentCyan: '#22D3EE',    // Latest hour / Curve
  accentMint: '#4ADE80',    // Total points / Event stars
  accentBlue: '#60A5FA',    // Average / hour
  accentPurple: '#C084FC',  // Best hour
  accentTag: '#34D399',     // Clan tag [MCWV]
};

const FONT_SANS = 'Inter, Segoe UI, Roboto, sans-serif';
let fontsLoaded = false;

function registerOptionalFonts(directory?: string): void {
  if (fontsLoaded) return;
  const p = directory ? resolve(directory, 'fonts') : resolve(process.cwd(), 'assets/fonts');
  if (existsSync(p)) {
    try {
      const displayPath = resolve(p, 'BarlowCondensed-SemiBold.ttf');
      const bodyPath = resolve(p, 'Barlow-SemiBold.ttf');
      if (existsSync(displayPath)) GlobalFonts.registerFromPath(displayPath, 'BarlowDisplay');
      if (existsSync(bodyPath)) GlobalFonts.registerFromPath(bodyPath, 'BarlowBody');
    } catch { /* fallback */ }
  }
  fontsLoaded = true;
}

export function safeNum(val: number | null | undefined, fallback = 0): number {
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

export function fmt(n: number | null | undefined): string {
  const val = safeNum(n, 0);
  const abs = Math.abs(val);
  if (abs >= 1e12) return `${(val / 1e12).toFixed(2)}t`;
  if (abs >= 1e9) return `${(val / 1e9).toFixed(2)}b`;
  if (abs >= 1e6) return `${(val / 1e6).toFixed(2)}m`;
  if (abs >= 1e3) return `${(val / 1e3).toFixed(2)}k`;
  return val.toLocaleString('en-US');
}

export function fmtExact(n: number | null | undefined): string {
  return safeNum(n, 0).toLocaleString('en-US');
}

export function getTimeframeConfig(mode: TimeframeMode): { totalMs: number; buckets: number; labels: string[] } {
  switch (mode) {
    case '30m': return { totalMs: 30 * 60_000, buckets: 14, labels: ['25m', '20m', '15m', '10m', '5m', 'NOW'] };
    case '1h':  return { totalMs: 60 * 60_000, buckets: 16, labels: ['50m', '40m', '30m', '20m', '10m', 'NOW'] };
    case '3h':  return { totalMs: 3 * 3_600_000, buckets: 18, labels: ['3h', '2.5h', '2h', '1.5h', '1h', 'NOW'] };
    case '6h':  return { totalMs: 6 * 3_600_000, buckets: 20, labels: ['5h', '4h', '3h', '2h', '1h', 'NOW'] };
    case '12h': return { totalMs: 12 * 3_600_000, buckets: 24, labels: ['12h', '9h', '6h', '3h', '1h', 'NOW'] };
    case '24h':
    default:    return { totalMs: 24 * 3_600_000, buckets: 24, labels: ['23h ago', '17h ago', '11h ago', '6h ago', 'NOW'] };
  }
}

export function extractBucketsForTimeframe(
  points: HistoryPoint[],
  totalMs: number,
  bucketCount: number,
  currentVal?: number,
): number[] {
  const buckets = new Array<number>(bucketCount).fill(0);
  void currentVal;
  if (!Array.isArray(points) || points.length < 2) return buckets;
  const now = Date.now();
  const step = totalMs / bucketCount;
  const sorted = [...points]
    .filter((p): p is HistoryPoint => typeof p?.ts === 'number' && Number.isFinite(p.ts) && typeof p?.value === 'number' && Number.isFinite(p.value))
    .sort((a, b) => a.ts - b.ts);

  for (let i = 0; i < bucketCount; i++) {
    const start = now - (bucketCount - i) * step;
    const end = start + step;
    const a = sorted.filter(p => p.ts <= start).slice(-1)[0] ?? sorted[0];
    const b = sorted.filter(p => p.ts <= end).slice(-1)[0] ?? a;
    if (a && b) buckets[i] = Math.max(0, b.value - a.value);
  }
  return buckets;
}

// ============================================================================
// DRAWING PRIMITIVES & ICONS
// ============================================================================

function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function rr(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number, fill?: string | CanvasGradient | null, stroke?: string | CanvasGradient | null, lw = 1): void {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  ctx.restore();
}

function txt(ctx: SKRSContext2D, text: string, x: number, y: number, size: number, color = C.textLight, bold = false, align: 'left' | 'center' | 'right' = 'left', maxW?: number): void {
  ctx.save();
  ctx.font = `${bold ? 700 : 500} ${size}px ${FONT_SANS}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  if (maxW) ctx.fillText(text, x, y, maxW);
  else ctx.fillText(text, x, y);
  ctx.restore();
}

// Minimal vector icons rendered in top-right of cards
function drawIcon(ctx: SKRSContext2D, type: 'star' | 'trophy' | 'bars' | 'bolt', cx: number, cy: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.7;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (type === 'star') {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (-90 + i * 72) * Math.PI / 180;
      const b = (-54 + i * 72) * Math.PI / 180;
      ctx.lineTo(cx + Math.cos(a) * 7.5, cy + Math.sin(a) * 7.5);
      ctx.lineTo(cx + Math.cos(b) * 3.4, cy + Math.sin(b) * 3.4);
    }
    ctx.closePath();
    ctx.stroke();
  } else if (type === 'trophy') {
    ctx.beginPath();
    ctx.moveTo(cx - 5.5, cy - 6);
    ctx.lineTo(cx + 5.5, cy - 6);
    ctx.lineTo(cx + 3.8, cy + 0.5);
    ctx.quadraticCurveTo(cx, cy + 4, cx - 3.8, cy + 0.5);
    ctx.closePath();
    ctx.stroke();
    ctx.strokeRect(cx - 1, cy + 3.5, 2, 2.5);
    ctx.strokeRect(cx - 4, cy + 6, 8, 1.5);
  } else if (type === 'bars') {
    ctx.fillRect(cx - 5, cy + 1, 2.2, 5);
    ctx.fillRect(cx - 1.1, cy - 3, 2.2, 9);
    ctx.fillRect(cx + 2.8, cy - 6, 2.2, 12);
  } else if (type === 'bolt') {
    ctx.beginPath();
    ctx.moveTo(cx + 1, cy - 7);
    ctx.lineTo(cx - 4, cy - 0.5);
    ctx.lineTo(cx - 0.5, cy - 0.5);
    ctx.lineTo(cx - 1.5, cy + 7);
    ctx.lineTo(cx + 4, cy + 0.5);
    ctx.lineTo(cx + 0.5, cy + 0.5);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

// Background Grid
function drawAppBackground(ctx: SKRSContext2D, w: number, h: number): void {
  ctx.fillStyle = C.bgApp;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
  ctx.lineWidth = 1;
  const step = 32;
  ctx.beginPath();
  for (let x = 0; x <= w; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = 0; y <= h; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
}

// ============================================================================
// AVATAR FETCHING
// ============================================================================

interface CacheItem<T> { value: T; expires: number }
const imageCache = new Map<string, CacheItem<Image>>();
const pendingImages = new Map<string, Promise<Image | null>>();

async function fetchImage(url: string): Promise<Image | null> {
  try {
    const u = new URL(url);
    if (!['https:', 'http:'].includes(u.protocol)) return null;
    const res = await fetch(u, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const img = await loadImage(Buffer.from(arrayBuffer));
    return img.width > 0 && img.height > 0 ? img : null;
  } catch { return null; }
}

async function loadRemote(url: string | null | undefined): Promise<Image | null> {
  if (!url) return null;
  const hit = imageCache.get(url);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (pendingImages.has(url)) return pendingImages.get(url)!;

  const p = fetchImage(url).then(img => {
    if (img) imageCache.set(url, { value: img, expires: Date.now() + 300_000 });
    return img;
  }).finally(() => pendingImages.delete(url));
  pendingImages.set(url, p);
  return p;
}

function drawCircularAvatar(ctx: SKRSContext2D, img: Image | null, cx: number, cy: number, r: number, borderColor = '#38BDF8'): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#171D29';
  ctx.fill();
  ctx.clip();

  if (img) {
    const scale = Math.max((r * 2) / img.width, (r * 2) / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
  } else {
    ctx.fillStyle = '#334155';
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ============================================================================
// STAT CARD COMPONENT
// ============================================================================

function drawStatCard(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number,
  label: string,
  value: string,
  valueColor: string,
  iconType: 'star' | 'trophy' | 'bars' | 'bolt'
): void {
  // Card base
  rr(ctx, x, y, w, h, 14, C.bgSubCard, C.borderCard, 1);

  // Top right icon button
  const ibSize = 28;
  const ibX = x + w - ibSize - 16;
  const ibY = y + 16;
  rr(ctx, ibX, ibY, ibSize, ibSize, 8, 'rgba(255, 255, 255, 0.03)', 'rgba(255, 255, 255, 0.08)', 1);
  drawIcon(ctx, iconType, ibX + ibSize / 2, ibY + ibSize / 2, valueColor);

  // Label
  txt(ctx, label, x + 20, y + 34, 13, C.textSecondary, false, 'left');

  // Value
  txt(ctx, value, x + 20, y + 74, 30, valueColor, true, 'left');
}

// ============================================================================
// GLOBAL RANK CARD (TOP RIGHT)
// ============================================================================

function drawGlobalRankCard(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number,
  rank: number,
  totalPlayers: string,
  percentileBehind: number,
  aheadUser?: { name: string; avatarUrl?: string | null } | null,
  behindUser?: { name: string; avatarUrl?: string | null } | null,
  aheadImg?: Image | null,
  behindImg?: Image | null,
): void {
  rr(ctx, x, y, w, h, 16, C.bgSubCard, C.borderCard, 1);

  // 1. Behind Player (Left)
  const leftX = x + 30;
  const midY = y + 48;
  txt(ctx, `#${rank + 1} · Behind`, leftX + 42, midY - 14, 10, C.textMuted, false, 'left');
  drawCircularAvatar(ctx, behindImg ?? null, leftX + 18, midY, 16, '#EF4444');
  txt(ctx, (behindUser?.name ?? 'repollito789').slice(0, 15), leftX, y + 80, 11, C.textLight, true, 'left');

  // 2. Global Rank (Center)
  const cx = x + w / 2;
  txt(ctx, 'GLOBAL RANK', cx, y + 30, 11, C.textMuted, true, 'center');
  txt(ctx, `#${rank}`, cx, y + 62, 34, C.textLight, true, 'center');
  txt(ctx, `of ${totalPlayers} players`, cx, y + 80, 11, C.textMuted, false, 'center');

  // 3. Ahead Player (Right)
  const rightX = x + w - 30;
  txt(ctx, `#${Math.max(1, rank - 1)} · Ahead`, rightX - 42, midY - 14, 10, C.textMuted, false, 'right');
  drawCircularAvatar(ctx, aheadImg ?? null, rightX - 18, midY, 16, '#22C55E');
  txt(ctx, (aheadUser?.name ?? 'Pandy_DandyLandy').slice(0, 15), rightX, y + 80, 11, C.textLight, true, 'right');

  // 4. Horizontal Track / Slider
  const barX = x + 24;
  const barY = y + 96;
  const barW = w - 48;
  const barH = 4;

  rr(ctx, barX, barY, barW, barH, 2, '#1E293B');

  // Gradient progress fill
  const pct = Math.max(0.02, Math.min(0.98, percentileBehind / 100));
  const fillGrad = ctx.createLinearGradient(barX, 0, barX + barW * pct, 0);
  fillGrad.addColorStop(0, '#38BDF8');
  fillGrad.addColorStop(1, '#A855F7');
  rr(ctx, barX, barY, barW * pct, barH, 2, fillGrad);

  // Glowing marker dot
  const dotX = barX + barW * pct;
  ctx.save();
  ctx.shadowColor = '#38BDF8';
  ctx.shadowBlur = 8;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(dotX, barY + barH / 2, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 5. Percentile Labels below slider
  const leftPct = `${percentileBehind.toFixed(2)}%`;
  const rightPct = `${(100 - percentileBehind).toFixed(2)}%`;

  txt(ctx, leftPct, barX + 60, y + 124, 17, '#38BDF8', true, 'center');
  txt(ctx, 'players behind', barX + 60, y + 138, 10, C.textMuted, false, 'center');

  txt(ctx, rightPct, barX + barW - 60, y + 124, 17, C.textLight, true, 'center');
  txt(ctx, 'players ahead', barX + barW - 60, y + 138, 10, C.textMuted, false, 'center');
}

// ============================================================================
// HOURLY PERFORMANCE SPLINE CHART (1:1 PARITY)
// ============================================================================

function drawSplineChart(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number,
  values: number[],
  labels: string[],
  averageValue: number,
  latestValue: number
): void {
  // Chart Container
  rr(ctx, x, y, w, h, 16, C.bgSubCard, C.borderCard, 1);

  // Header Title
  txt(ctx, 'Hourly performance', x + 24, y + 36, 17, C.textLight, true, 'left');
  txt(ctx, 'Points earned per hour · Last 24 hours', x + 24, y + 54, 12, C.textMuted, false, 'left');

  // Legend at top right
  const legRight = x + w - 28;
  txt(ctx, 'Average', legRight, y + 38, 12, C.textSecondary, false, 'right');
  ctx.save();
  ctx.strokeStyle = '#60A5FA';
  ctx.lineWidth = 1.8;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(legRight - 65, y + 34);
  ctx.lineTo(legRight - 50, y + 34);
  ctx.stroke();
  ctx.restore();

  txt(ctx, 'Hourly points', legRight - 85, y + 38, 12, C.textSecondary, false, 'right');
  ctx.fillStyle = C.accentCyan;
  ctx.beginPath();
  ctx.arc(legRight - 160, y + 34, 4, 0, Math.PI * 2);
  ctx.fill();

  // Plot bounds
  const px = x + 75;
  const py = y + 85;
  const pw = w - 105;
  const ph = h - 135;
  const bottom = py + ph;

  const maxVal = Math.max(...values, averageValue, 10);
  const yCeil = maxVal * 1.25;

  // Y-Axis Horizontal Grid lines & Labels
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const gy = py + (ph * i) / yTicks;
    const val = yCeil * (1 - i / yTicks);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, gy);
    ctx.lineTo(px + pw, gy);
    ctx.stroke();

    txt(ctx, i === yTicks ? '0' : fmt(val), px - 12, gy + 4, 11, C.textMuted, false, 'right');
  }

  // Dashed Average Line across chart
  const avgY = bottom - (averageValue / yCeil) * ph;
  ctx.save();
  ctx.strokeStyle = 'rgba(96, 165, 250, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(px, avgY);
  ctx.lineTo(px + pw, avgY);
  ctx.stroke();
  ctx.restore();

  // Map Data Points
  const count = values.length;
  const stepX = pw / Math.max(1, count - 1);
  const pts = values.map((val, i) => ({
    x: px + i * stepX,
    y: bottom - (val / yCeil) * ph
  }));

  if (pts.length >= 2) {
    // 1. Draw glowing gradient area beneath curve
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, bottom);
    ctx.lineTo(pts[0]!.x, pts[0]!.y);

    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i]!;
      const p2 = pts[i + 1]!;
      const mx = (p1.x + p2.x) / 2;
      ctx.bezierCurveTo(mx, p1.y, mx, p2.y, p2.x, p2.y);
    }

    ctx.lineTo(pts[pts.length - 1]!.x, bottom);
    ctx.closePath();

    const areaGrad = ctx.createLinearGradient(0, py, 0, bottom);
    areaGrad.addColorStop(0, 'rgba(34, 211, 238, 0.28)');
    areaGrad.addColorStop(0.7, 'rgba(34, 211, 238, 0.05)');
    areaGrad.addColorStop(1, 'rgba(34, 211, 238, 0.0)');
    ctx.fillStyle = areaGrad;
    ctx.fill();
    ctx.restore();

    // 2. Draw thick smooth stroke
    ctx.save();
    ctx.strokeStyle = '#22D3EE';
    ctx.lineWidth = 3.5;
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(34, 211, 238, 0.5)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);

    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i]!;
      const p2 = pts[i + 1]!;
      const mx = (p1.x + p2.x) / 2;
      ctx.bezierCurveTo(mx, p1.y, mx, p2.y, p2.x, p2.y);
    }
    ctx.stroke();
    ctx.restore();

    // 3. Circular dots on every hour point
    pts.forEach(p => {
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#22D3EE';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    // 4. Latest Hour Pill Tooltip over the last point
    const lastP = pts[pts.length - 1]!;
    const pillVal = fmt(latestValue);
    const pillW = 85;
    const pillH = 28;
    const pillX = Math.max(px, Math.min(px + pw - pillW, lastP.x - pillW + 12));
    const pillY = lastP.y - pillH - 12;

    rr(ctx, pillX, pillY, pillW, pillH, 8, 'rgba(15, 23, 42, 0.92)', '#22D3EE', 1.2);
    txt(ctx, pillVal, pillX + pillW / 2, pillY + 18, 13, '#22D3EE', true, 'center');
  }

  // X-Axis Time Ticks
  const xTickIndices = [0, 6, 12, 18, count - 1];
  xTickIndices.forEach((idx, i) => {
    const lx = px + idx * stepX;
    const label = labels[i] ?? (i === 4 ? 'NOW' : `${24 - i * 6}h ago`);
    txt(ctx, label, lx, bottom + 24, 12, i === 4 ? C.textLight : C.textMuted, i === 4, 'center');
  });
}

// ============================================================================
// MAIN RENDER EXPORT (1:1 LAYOUT)
// ============================================================================

export async function renderHistory(
  title: string,
  subtitle: string,
  stats: HistoryStats,
  avatarUrl: string | null,
  selectedTimeframe: TimeframeMode = '24h',
  rivalry?: ClanRivalryInfo | null,
  userId?: number | null,
  options: HistoryRenderOptions = {},
): Promise<Buffer> {
  const w = 1520, h = 920;
  const scale = options.scale === 1 ? 1 : 2;
  const canvas = createCanvas(w * scale, h * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  registerOptionalFonts(options.assetDirectory);

  // Load avatar and rivals avatars
  const avatar = await loadRemote(avatarUrl ?? options.avatarRenderUrl);

  // 1. Dark Background with Grid Pattern
  drawAppBackground(ctx, w, h);

  // 2. Main Outer Card (35px margin)
  const mx = 35, my = 35, mw = w - 70, mh = h - 70;
  rr(ctx, mx, my, mw, mh, 20, C.bgCard, C.borderCard, 1);

  // Neon Gradient Top Line (Matching Screenshots)
  const topGrad = ctx.createLinearGradient(mx + 20, 0, mx + mw - 20, 0);
  topGrad.addColorStop(0, '#2DD4BF');
  topGrad.addColorStop(0.3, '#38BDF8');
  topGrad.addColorStop(0.7, '#C084FC');
  topGrad.addColorStop(1, '#F472B6');
  rr(ctx, mx + 20, my + 1, mw - 40, 3, 1.5, topGrad);

  // 3. Parse Clan Tag & Event Name
  const cleanSubtitle = subtitle.replace(/[\[\]]/g, '');
  const parts = cleanSubtitle.split(/[•|]/).map(s => s.trim()).filter(Boolean);
  const clanTag = parts[0] || 'MCWV';
  const eventName = parts[1] || 'SpaceMineBattle2026';

  // 4. Extract 24 Hourly Buckets
  const tfConfig = getTimeframeConfig(selectedTimeframe);
  const buckets = extractBucketsForTimeframe(stats?.points ?? [], tfConfig.totalMs, 24, stats?.current);
  const total24h = buckets.reduce((a, b) => a + b, 0);
  const avgHour = total24h / 24;
  const bestHour = Math.max(...buckets, 0);
  const latestHour = buckets[buckets.length - 1] ?? 0;
  const currentTotal = safeNum(stats?.current, total24h);

  // 5. Header Area: Left Profile Block
  const avX = mx + 68;
  const avY = my + 72;
  const avR = 40;
  drawCircularAvatar(ctx, avatar, avX, avY, avR, '#38BDF8');

  // Player Name
  txt(ctx, title, avX + 54, avY - 8, 32, C.textLight, true, 'left');

  // Clan Tag Badge & Event Name
  const badgeX = avX + 54;
  const badgeY = avY + 12;
  const badgeW = clanTag.length * 9 + 20;
  rr(ctx, badgeX, badgeY, badgeW, 22, 6, '#0E1E28', '#104A3C', 1);
  txt(ctx, `[${clanTag}]`, badgeX + badgeW / 2, badgeY + 15, 11, C.accentTag, true, 'center');
  txt(ctx, eventName, badgeX + badgeW + 12, badgeY + 16, 14, C.textSecondary, false, 'left');

  // 6. Header Area: Global Rank Card (Top Right)
  const rankCardW = 540;
  const rankCardH = 150;
  const rankCardX = mx + mw - rankCardW - 24;
  const rankCardY = my + 24;
  const globalRank = rivalry?.rank ?? 280;
  const pctBehind = 99.37;

  drawGlobalRankCard(
    ctx,
    rankCardX, rankCardY, rankCardW, rankCardH,
    globalRank,
    '44.05k',
    pctBehind,
    rivalry?.ahead ? { name: rivalry.ahead.name } : null,
    rivalry?.behind ? { name: rivalry.behind.name } : null
  );

  // 7. Middle Top Cards (Event stars & Clan rank)
  const cardRowY = my + 130;
  const twoCardW = 400;
  const cardH = 92;

  drawStatCard(ctx, mx + 24, cardRowY, twoCardW, cardH, 'Event stars', fmt(currentTotal), C.accentCyan, 'star');
  drawStatCard(ctx, mx + 24 + twoCardW + 14, cardRowY, twoCardW, cardH, `Clan rank · ${clanTag}`, `${globalRank}/75`, C.accentMint, 'trophy');

  // 8. Row of 4 Stat Cards
  const fourRowY = cardRowY + cardH + 16;
  const fourCardW = (mw - 48 - 42) / 4;

  drawStatCard(ctx, mx + 24, fourRowY, fourCardW, cardH, 'Total points · 24h', fmt(total24h), C.accentMint, 'star');
  drawStatCard(ctx, mx + 24 + (fourCardW + 14), fourRowY, fourCardW, cardH, 'Average / hour', fmt(avgHour), C.accentBlue, 'bars');
  drawStatCard(ctx, mx + 24 + (fourCardW + 14) * 2, fourRowY, fourCardW, cardH, 'Best hour', fmt(bestHour), C.accentPurple, 'trophy');
  drawStatCard(ctx, mx + 24 + (fourCardW + 14) * 3, fourRowY, fourCardW, cardH, 'Latest hour', fmt(latestHour), C.accentCyan, 'bolt');

  // 9. Bottom Large Spline Chart (Hourly performance)
  const chartY = fourRowY + cardH + 16;
  const chartW = mw - 48;
  const chartH = mh - (chartY - my) - 24;

  drawSplineChart(
    ctx,
    mx + 24, chartY, chartW, chartH,
    buckets,
    tfConfig.labels,
    avgHour,
    latestHour
  );

  return canvas.encode('png');
}

// ============================================================================
// COMPATIBILITY EXPORTS FOR PLAYER CARD & RAP
// ============================================================================

export async function renderPlayerCard(
  title: string,
  subtitle: string,
  avatarUrl: string | null,
  userId?: number | null,
  options: PlayerCardRenderOptions = {},
): Promise<Buffer> {
  const w = 640, h = 420;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  drawAppBackground(ctx, w, h);
  rr(ctx, 24, 24, w - 48, h - 48, 18, C.bgCard, C.borderCard, 1);

  const avatar = await loadRemote(avatarUrl);
  drawCircularAvatar(ctx, avatar, 90, 90, 44, '#38BDF8');

  txt(ctx, title, 155, 82, 28, C.textLight, true);
  txt(ctx, subtitle, 155, 108, 14, C.textSecondary, false);

  rr(ctx, 40, 160, w - 80, 80, 14, C.bgSubCard, C.borderCard, 1);
  txt(ctx, 'ASSIGNED ROLE', 60, 192, 11, C.textMuted, false);
  txt(ctx, options.roleLabel ?? 'MEMBER', 60, 222, 22, C.accentMint, true);

  return canvas.encode('png');
}

export async function renderRap(r: RapResult): Promise<Buffer> {
  const w = 1200, h = 680, scale = 2;
  const canvas = createCanvas(w * scale, h * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  drawAppBackground(ctx, w, h);
  rr(ctx, 35, 35, w - 70, h - 70, 20, C.bgCard, C.borderCard, 1);

  txt(ctx, 'RAP TRACKER', 60, 85, 32, C.textLight, true);
  txt(ctx, 'PET VALUATION & MARKET INTELLIGENCE', 60, 112, 12, C.textMuted, false);

  rr(ctx, 60, 145, 340, 450, 16, C.bgSubCard, C.borderCard, 1);
  const img = await loadRemote(r.imageUrl);
  if (img) {
    const f = Math.min(260 / img.width, 240 / img.height);
    const dw = img.width * f, dh = img.height * f;
    ctx.drawImage(img, 60 + (340 - dw) / 2, 180 + (240 - dh) / 2, dw, dh);
  }
  txt(ctx, r.name, 230, 480, 22, C.textLight, true, 'center');

  rr(ctx, 420, 145, 720, 450, 16, C.bgSubCard, C.borderCard, 1);
  txt(ctx, 'MARKET VARIANTS', 450, 185, 18, C.textLight, true);

  const vars = Array.isArray(r.variants) ? r.variants.slice(0, 5) : [];
  vars.forEach((v, i) => {
    const yy = 215 + i * 65;
    rr(ctx, 450, yy, 660, 52, 12, '#1E2536', 'rgba(255, 255, 255, 0.05)', 1);
    txt(ctx, v.label, 470, yy + 32, 16, C.textLight, true);
    txt(ctx, fmt(v.value), 820, yy + 32, 18, C.textLight, true, 'right');
    const d = v.delta ?? 0;
    txt(ctx, `${d >= 0 ? '+' : ''}${fmt(d)}`, 1080, yy + 32, 16, d >= 0 ? C.accentMint : '#EF4444', true, 'right');
  });

  return canvas.encode('png');
}
