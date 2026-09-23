import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D, type Image } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { HistoryStats } from '../services/HistoryService.js';
import type { RapResult } from '../services/RapService.js';
import type { HistoryPoint } from '../types.js';

// ============================================================================
// R3V0 PLAYER HISTORY V8 CLEAN ASSET EDITION
// Purple fantasy / cartoon clan renderer.
// Uses local R3V0 fantasy assets plus Canvas for dynamic player/clan data.
// Existing public renderer API is preserved for drop-in compatibility.
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

export interface VectorPoint { x: number; y: number; val: number }
export interface TierStyle {
  label: string;
  color: string;
  glowColor: string;
  badgeBg: string;
  badgeBorder: string;
}
export interface Particle { x: number; y: number; size: number; alpha: number; speed: number }
export interface StarParticle { x: number; y: number; r: number; alpha: number }
export interface ClanLeaderboardEntry { rank: number; name: string; points: number }

export interface HistoryRenderOptions {
  /** Retained for backward compatibility. V7 does not render a clan leaderboard. */
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
// COMMON DATA HELPERS
// ============================================================================

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
  return val.toFixed(0);
}

export function fmtExact(n: number | null | undefined): string {
  return safeNum(n, 0).toLocaleString('en-US');
}

export function getPerformanceTier(latestVal: number, avgVal: number): TierStyle {
  if (latestVal <= 0) return { label: 'IDLE', color: '#C4B5FD', glowColor: 'rgba(196,181,253,.35)', badgeBg: 'rgba(76,29,149,.42)', badgeBorder: '#8B5CF6' };
  const ratio = avgVal > 0 ? latestVal / avgVal : 1;
  if (ratio < .6) return { label: 'LOW TEMPO', color: '#F9A8D4', glowColor: 'rgba(249,168,212,.38)', badgeBg: 'rgba(131,24,67,.35)', badgeBorder: '#EC4899' };
  if (ratio < 1.3) return { label: 'STEADY', color: '#E9D5FF', glowColor: 'rgba(233,213,255,.36)', badgeBg: 'rgba(88,28,135,.36)', badgeBorder: '#C084FC' };
  if (ratio < 2.5) return { label: 'SURGING', color: '#67E8F9', glowColor: 'rgba(103,232,249,.38)', badgeBg: 'rgba(8,145,178,.25)', badgeBorder: '#22D3EE' };
  return { label: 'OVERCLOCKED', color: '#F0ABFC', glowColor: 'rgba(240,171,252,.45)', badgeBg: 'rgba(147,51,234,.35)', badgeBorder: '#D946EF' };
}

export function getTimeframeConfig(mode: TimeframeMode): { totalMs: number; buckets: number; labels: string[] } {
  switch (mode) {
    case '30m': return { totalMs: 30 * 60_000, buckets: 12, labels: ['25m', '20m', '15m', '10m', '5m', 'NOW'] };
    case '1h': return { totalMs: 60 * 60_000, buckets: 12, labels: ['50m', '40m', '30m', '20m', '10m', 'NOW'] };
    case '3h': return { totalMs: 3 * 3_600_000, buckets: 18, labels: ['3h', '2.5h', '2h', '1.5h', '1h', 'NOW'] };
    case '6h': return { totalMs: 6 * 3_600_000, buckets: 18, labels: ['5h', '4h', '3h', '2h', '1h', 'NOW'] };
    case '12h': return { totalMs: 12 * 3_600_000, buckets: 24, labels: ['12h', '9h', '6h', '3h', '1h', 'NOW'] };
    case '24h':
    default: return { totalMs: 24 * 3_600_000, buckets: 24, labels: ['-24h', '-21h', '-18h', '-15h', '-12h', '-9h', '-6h', '-3h', 'NOW'] };
  }
}

export function extractBucketsForTimeframe(points: HistoryPoint[], totalMs: number, bucketCount: number, currentVal: number): number[] {
  const buckets = new Array<number>(bucketCount).fill(0);
  void currentVal;
  if (!Array.isArray(points) || points.length < 2) return buckets;
  const now = Date.now();
  const step = totalMs / bucketCount;
  const sorted = [...points].filter(p => Number.isFinite(p.ts) && Number.isFinite(p.value)).sort((a, b) => a.ts - b.ts);
  for (let i = 0; i < bucketCount; i++) {
    const start = now - (bucketCount - i) * step;
    const end = start + step;
    const a = sorted.filter(p => p.ts <= start).slice(-1)[0] ?? sorted[0];
    const b = sorted.filter(p => p.ts <= end).slice(-1)[0] ?? a;
    if (a && b) buckets[i] = Math.max(0, b.value - a.value);
  }
  return buckets;
}

export function buildClampedSmoothPath(ctx: SKRSContext2D, points: VectorPoint[], bottomY: number): void {
  if (points.length <= 1) return;
  if (points.length === 2) { ctx.lineTo(points[1]!.x, points[1]!.y); return; }
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = i > 0 ? points[i - 1]! : points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = i < points.length - 2 ? points[i + 2]! : p2;
    if (p1.val === 0 && p2.val === 0) { ctx.lineTo(p2.x, bottomY); continue; }
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
}

// ============================================================================
// THEME / FONT / DRAWING PRIMITIVES
// ============================================================================

type Paint = SKRSContext2D['fillStyle'];
type Align = 'left' | 'center' | 'right';

const P = {
  bg0: '#090313', bg1: '#180728', bg2: '#2A0A42', panel0: '#160923', panel1: '#240D38', panel2: '#32114A',
  purple: '#A855F7', purple2: '#D946EF', magenta: '#F472F6', lavender: '#E9D5FF', violet: '#7C3AED',
  cyan: '#67E8F9', green: '#5EEAD4', white: '#FFF8FF', text: '#F6ECFF', muted: '#C9AED9', dim: '#8F6FA5',
  outline: '#080311', ink: '#12051F', grid: 'rgba(197,139,255,.14)',
};

const DISPLAY = 'R3V0Display, DejaVu Sans, sans-serif';
const BODY = 'R3V0Body, DejaVu Sans, sans-serif';
let fontDirLoaded: string | null = null;

function assetDir(explicit?: string): string {
  if (explicit) return resolve(explicit);
  const candidates = [
    resolve(process.cwd(), 'assets/tactical'),
    fileURLToPath(new URL('../../assets/tactical/', import.meta.url)),
    fileURLToPath(new URL('../../../assets/tactical/', import.meta.url)),
  ];
  return candidates.find(p => existsSync(p)) ?? candidates[0]!;
}

function registerFonts(directory: string): void {
  if (fontDirLoaded === directory) return;
  const defs: [string, string][] = [
    ['BarlowCondensed-SemiBold.ttf', 'R3V0Display'], ['BarlowCondensed-Medium.ttf', 'R3V0Display'],
    ['Barlow-SemiBold.ttf', 'R3V0Body'], ['Barlow-Regular.ttf', 'R3V0Body'],
  ];
  for (const [file, alias] of defs) {
    const p = resolve(directory, 'fonts', file);
    if (existsSync(p)) { try { GlobalFonts.registerFromPath(p, alias); } catch { /* fallback */ } }
  }
  fontDirLoaded = directory;
}

interface ClanAssets {
  background: Image | null;
  logo: Image | null;
  frameMain: Image | null;
  frameChart: Image | null;
  panelTexture: Image | null;
  platform: Image | null;
  crystals: Image | null;
  angel: Image | null;
  bat: Image | null;
  cat: Image | null;
  crystalCat: Image | null;
  coins: Image | null;
  pillar: Image | null;
  headerOrnament: Image | null;
  sideOrnament: Image | null;
  icons: Image | null;
}

function assetsRoot(directory: string): string {
  return resolve(directory, '..');
}

async function localImage(path: string): Promise<Image | null> {
  try {
    if (!existsSync(path)) return null;
    const img = await loadImage(path);
    return img.width > 0 && img.height > 0 ? img : null;
  } catch { return null; }
}

async function loadClanAssets(directory: string): Promise<ClanAssets> {
  const branding = resolve(assetsRoot(directory), 'branding');
  const ui = resolve(branding, 'ui');
  const names = {
    background: resolve(ui, 'background.png'),
    logo: resolve(branding, 'r3v0-logo.png'),
    frameMain: resolve(ui, 'frame-main.png'),
    frameChart: resolve(ui, 'frame-chart.png'),
    panelTexture: resolve(ui, 'panel-texture.png'),
    platform: resolve(ui, 'platform.png'),
    crystals: resolve(ui, 'crystals.png'),
    angel: resolve(ui, 'pet-angel.png'),
    bat: resolve(ui, 'pet-bat.png'),
    cat: resolve(ui, 'pet-cat.png'),
    crystalCat: resolve(ui, 'crystal-cat-combo.png'),
    coins: resolve(ui, 'coins.png'),
    pillar: resolve(ui, 'pillar.png'),
    headerOrnament: resolve(ui, 'header-ornament.png'),
    sideOrnament: resolve(ui, 'side-ornament.png'),
    icons: resolve(ui, 'icons-sheet.png'),
  };
  const entries = await Promise.all(Object.entries(names).map(async ([k, v]) => [k, await localImage(v)] as const));
  return Object.fromEntries(entries) as unknown as ClanAssets;
}

function drawContain(ctx: SKRSContext2D, img: Image | null, x: number, y: number, w: number, h: number, alpha = 1): void {
  if (!img) return;
  const f = Math.min(w / img.width, h / img.height);
  const dw = img.width * f, dh = img.height * f;
  ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); ctx.restore();
}

function drawCover(ctx: SKRSContext2D, img: Image | null, x: number, y: number, w: number, h: number, alpha = 1): void {
  if (!img) return;
  const f = Math.max(w / img.width, h / img.height);
  const dw = img.width * f, dh = img.height * f;
  ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); ctx.restore();
}

function drawContainFlipped(ctx: SKRSContext2D, img: Image | null, x: number, y: number, w: number, h: number, flipX = false, alpha = 1): void {
  if (!img) return;
  const f = Math.min(w / img.width, h / img.height);
  const dw = img.width * f, dh = img.height * f;
  const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
  ctx.save(); ctx.globalAlpha = alpha;
  if (flipX) { ctx.translate(dx + dw, dy); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0, dw, dh); }
  else ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

function drawAtlasIcon(ctx: SKRSContext2D, sheet: Image | null, index: number, x: number, y: number, size: number, alpha = 1): void {
  if (!sheet) return;
  const cols = 3, rows = 2;
  const cellW = sheet.width / cols, cellH = sheet.height / rows;
  const col = Math.max(0, Math.min(cols - 1, index % cols));
  const row = Math.max(0, Math.min(rows - 1, Math.floor(index / cols)));
  ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(sheet, col * cellW, row * cellH, cellW, cellH, x, y, size, size); ctx.restore();
}

function roundedPath(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath(); ctx.moveTo(x + rr, y); ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr); ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h); ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr); ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y); ctx.closePath();
}

function rr(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number, fill: Paint | null, stroke?: Paint | null, width = 1): void {
  ctx.save(); roundedPath(ctx, x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
  ctx.restore();
}

function grad(ctx: SKRSContext2D, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]): Paint {
  const g = ctx.createLinearGradient(x0, y0, x1, y1); for (const [p, c] of stops) g.addColorStop(p, c); return g;
}

function txt(ctx: SKRSContext2D, value: string, x: number, y: number, size: number, color = P.text, bold = false, align: Align = 'left', maxWidth?: number): void {
  ctx.save(); ctx.font = `${bold ? 700 : 500} ${size}px ${bold ? DISPLAY : BODY}`; ctx.fillStyle = color;
  ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  if (maxWidth) ctx.fillText(String(value), x, y, maxWidth); else ctx.fillText(String(value), x, y);
  ctx.restore();
}

function caps(ctx: SKRSContext2D, value: string, x: number, y: number, size = 12, color = P.muted, align: Align = 'left', tracking = 2): void {
  ctx.save(); const t = String(value).toUpperCase(); ctx.font = `700 ${size}px ${BODY}`; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic';
  const widths = [...t].map(ch => ctx.measureText(ch).width); const total = widths.reduce((a, b) => a + b, 0) + Math.max(0, t.length - 1) * tracking;
  let dx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  [...t].forEach((ch, i) => { ctx.fillText(ch, dx, y); dx += widths[i]! + tracking; }); ctx.restore();
}

function line(ctx: SKRSContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width = 1): void {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
}

function polygon(ctx: SKRSContext2D, pts: readonly (readonly [number, number])[], fill: Paint | null, stroke?: string, width = 1): void {
  if (!pts.length) return; ctx.save(); ctx.beginPath(); ctx.moveTo(pts[0]![0], pts[0]![1]); pts.slice(1).forEach(p => ctx.lineTo(p[0], p[1])); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); } ctx.restore();
}

function fitText(ctx: SKRSContext2D, value: string, maxWidth: number, size: number, family = DISPLAY): number {
  ctx.save(); let s = size; while (s > 9) { ctx.font = `700 ${s}px ${family}`; if (ctx.measureText(value).width <= maxWidth) break; s -= .5; } ctx.restore(); return s;
}

// ============================================================================
// VECTOR ICONS / CARTOON DECORATIONS
// ============================================================================

export function drawVectorStar(ctx: SKRSContext2D, cx: number, cy: number, radius: number, fillColor = '#FFFFFF', strokeColor = '#7C3AED', lineWidth = 2): void {
  ctx.save(); ctx.fillStyle = fillColor; ctx.strokeStyle = strokeColor; ctx.lineWidth = lineWidth; ctx.lineJoin = 'round'; ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (-90 + i * 72) * Math.PI / 180; const b = (-54 + i * 72) * Math.PI / 180;
    ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    ctx.lineTo(cx + Math.cos(b) * radius * .45, cy + Math.sin(b) * radius * .45);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
}

export function drawVectorCrown(ctx: SKRSContext2D, cx: number, cy: number, width: number, fillColor = '#FFFFFF', strokeColor = '#8B5CF6', lineWidth = 2.5): void {
  const h = width * .56; ctx.save(); ctx.lineJoin = 'round'; ctx.fillStyle = fillColor; ctx.strokeStyle = strokeColor; ctx.lineWidth = lineWidth;
  ctx.beginPath(); ctx.moveTo(cx - width / 2, cy + h / 2); ctx.lineTo(cx - width / 2, cy - h * .12); ctx.lineTo(cx - width * .27, cy + h * .04);
  ctx.lineTo(cx, cy - h / 2); ctx.lineTo(cx + width * .27, cy + h * .04); ctx.lineTo(cx + width / 2, cy - h * .12); ctx.lineTo(cx + width / 2, cy + h / 2); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#D946EF'; ctx.beginPath(); ctx.arc(cx, cy + h * .13, 3, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}

export function drawVectorTrophy(ctx: SKRSContext2D, cx: number, cy: number, size: number, fillColor = '#F3E8FF', strokeColor = '#9333EA'): void {
  ctx.save(); ctx.fillStyle = fillColor; ctx.strokeStyle = strokeColor; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(cx - size * .42, cy - size * .42); ctx.lineTo(cx + size * .42, cy - size * .42); ctx.lineTo(cx + size * .28, cy + size * .05);
  ctx.quadraticCurveTo(cx, cy + size * .34, cx - size * .28, cy + size * .05); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillRect(cx - 2.5, cy + size * .25, 5, size * .24); rr(ctx, cx - size * .28, cy + size * .47, size * .56, size * .15, 3, fillColor, strokeColor, 2); ctx.restore();
}

export function drawVectorClock(ctx: SKRSContext2D, cx: number, cy: number, radius: number, strokeColor = '#F3E8FF'): void {
  ctx.save(); ctx.strokeStyle = strokeColor; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
  line(ctx, cx, cy, cx, cy - radius * .55, strokeColor, 2.5); line(ctx, cx, cy, cx + radius * .45, cy + radius * .12, strokeColor, 2.5); ctx.restore();
}

export function drawVectorSpeedo(ctx: SKRSContext2D, cx: number, cy: number, radius: number, strokeColor = '#F3E8FF'): void {
  ctx.save(); ctx.strokeStyle = strokeColor; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(cx, cy, radius, Math.PI, 0); ctx.stroke(); line(ctx, cx, cy, cx + radius * .55, cy - radius * .42, P.magenta, 2.5); ctx.restore();
}

export function drawVectorPieChart(ctx: SKRSContext2D, cx: number, cy: number, radius: number, percentage: number): void {
  const pct = Math.max(0, Math.min(100, percentage)); ctx.save(); ctx.lineWidth = 9; ctx.strokeStyle = '#3B1552'; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
  const g = ctx.createLinearGradient(cx - radius, cy, cx + radius, cy); g.addColorStop(0, P.purple2); g.addColorStop(1, P.cyan); ctx.strokeStyle = g; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct / 100); ctx.stroke(); ctx.restore();
}

export function drawVectorBars(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, color = '#D946EF'): void {
  const bw = w / 5; ctx.save(); ctx.fillStyle = color; ctx.fillRect(x, y + h * .56, bw, h * .44); ctx.fillRect(x + bw * 1.45, y + h * .36, bw, h * .64); ctx.fillRect(x + bw * 2.9, y + h * .12, bw, h * .88); ctx.restore();
}

export function drawVectorPickaxe(ctx: SKRSContext2D, cx: number, cy: number, size: number): void {
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(-.55); ctx.strokeStyle = '#F5D0FE'; ctx.lineWidth = 4; line(ctx, 0, -size * .35, 0, size * .4, '#C084FC', 4); ctx.beginPath(); ctx.arc(0, -size * .30, size * .40, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); ctx.restore();
}

export function drawVectorHeart(ctx: SKRSContext2D, cx: number, cy: number, size: number, color = '#F472B6'): void {
  ctx.save(); ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(cx, cy + size * .35); ctx.bezierCurveTo(cx - size * .62, cy - size * .08, cx - size * .52, cy - size * .52, cx, cy - size * .18); ctx.bezierCurveTo(cx + size * .52, cy - size * .52, cx + size * .62, cy - size * .08, cx, cy + size * .35); ctx.fill(); ctx.restore();
}

function drawSparkle(ctx: SKRSContext2D, x: number, y: number, r: number, color = '#FFFFFF', alpha = 1): void {
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, y - r); ctx.quadraticCurveTo(x + r * .18, y - r * .18, x + r, y); ctx.quadraticCurveTo(x + r * .18, y + r * .18, x, y + r); ctx.quadraticCurveTo(x - r * .18, y + r * .18, x - r, y); ctx.quadraticCurveTo(x - r * .18, y - r * .18, x, y - r); ctx.fill(); ctx.restore();
}

function drawCrystal(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, flip = false): void {
  const s = flip ? -1 : 1; ctx.save(); ctx.translate(x, y); ctx.scale(s, 1); ctx.shadowColor = '#D946EF'; ctx.shadowBlur = 14;
  polygon(ctx, [[0, -h / 2], [w * .45, -h * .08], [w * .28, h / 2], [-w * .26, h / 2], [-w * .45, -h * .08]], grad(ctx, 0, -h / 2, 0, h / 2, [[0, '#FFF6FF'], [.28, '#E879F9'], [.72, '#A855F7'], [1, '#5B21B6']]), '#F5D0FE', 1.4);
  polygon(ctx, [[0, -h / 2], [w * .12, h / 2], [-w * .16, h / 2]], 'rgba(255,255,255,.26)'); ctx.restore();
}

function drawCrystalCluster(ctx: SKRSContext2D, x: number, y: number, scale = 1, mirror = false): void {
  ctx.save(); ctx.translate(x, y); if (mirror) ctx.scale(-1, 1); drawCrystal(ctx, 0, -8 * scale, 21 * scale, 52 * scale); drawCrystal(ctx, -18 * scale, 3 * scale, 16 * scale, 37 * scale, true); drawCrystal(ctx, 18 * scale, 5 * scale, 14 * scale, 31 * scale); ctx.restore();
}

function drawCoin(ctx: SKRSContext2D, x: number, y: number, r: number): void {
  ctx.save(); ctx.shadowColor = P.purple2; ctx.shadowBlur = 10; ctx.fillStyle = grad(ctx, x - r, y - r, x + r, y + r, [[0, '#F5D0FE'], [.5, '#A855F7'], [1, '#4C1D95']]); ctx.strokeStyle = '#F3E8FF'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.arc(x, y, r * .66, 0, Math.PI * 2); ctx.stroke(); ctx.fillStyle = '#FDF4FF'; ctx.beginPath(); ctx.arc(x, y, r * .18, 0, Math.PI * 2); ctx.fill(); ctx.restore();
}

function drawCloud(ctx: SKRSContext2D, x: number, y: number, scale: number, alpha = 1): void {
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = '#3B1556'; const circles = [[0, 6, 24], [25, 0, 32], [58, 8, 26], [83, 14, 21]] as const;
  circles.forEach(([dx, dy, r]) => { ctx.beginPath(); ctx.arc(x + dx * scale, y + dy * scale, r * scale, 0, Math.PI * 2); ctx.fill(); }); ctx.fillRect(x - 20 * scale, y + 9 * scale, 120 * scale, 34 * scale); ctx.restore();
}

function drawMascot(ctx: SKRSContext2D, x: number, y: number, size: number, variant: 'angel' | 'bat' | 'cube' = 'angel', alpha = 1): void {
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y); const r = size * .16;
  if (variant === 'angel') {
    ctx.fillStyle = '#FDF4FF'; ctx.strokeStyle = '#C084FC'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(-size * .42, 0, size * .20, size * .31, -.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.ellipse(size * .42, 0, size * .20, size * .31, .4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#F5D0FE'; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(0, -size * .48, size * .26, size * .08, 0, 0, Math.PI * 2); ctx.stroke();
  } else if (variant === 'bat') {
    polygon(ctx, [[-size * .34, -size * .06], [-size * .62, -size * .28], [-size * .54, .04], [-size * .70, size * .12], [-size * .32, size * .20]], '#20102F', '#D946EF', 2);
    polygon(ctx, [[size * .34, -size * .06], [size * .62, -size * .28], [size * .54, .04], [size * .70, size * .12], [size * .32, size * .20]], '#20102F', '#D946EF', 2);
  }
  const body = grad(ctx, -size / 2, -size / 2, size / 2, size / 2, variant === 'bat' ? [[0, '#2A1537'], [1, '#100815']] : [[0, '#FFFFFF'], [.55, '#F5D0FE'], [1, '#D8B4FE']]);
  rr(ctx, -size * .34, -size * .32, size * .68, size * .64, r, body, variant === 'bat' ? '#D946EF' : '#C084FC', 2);
  ctx.fillStyle = variant === 'bat' ? '#F0ABFC' : '#3B0764'; ctx.beginPath(); ctx.arc(-size * .12, -size * .02, size * .052, 0, Math.PI * 2); ctx.arc(size * .12, -size * .02, size * .052, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = variant === 'bat' ? '#F0ABFC' : '#5B217F'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, size * .08, size * .09, .15 * Math.PI, .85 * Math.PI); ctx.stroke(); ctx.restore();
}

function drawCrownBadge(ctx: SKRSContext2D, x: number, y: number, value: string): void {
  ctx.save(); ctx.shadowColor = '#D946EF'; ctx.shadowBlur = 18; rr(ctx, x - 41, y - 22, 82, 46, 13, '#190925', '#E9D5FF', 2.2); drawVectorCrown(ctx, x, y - 27, 44, '#FFFFFF', '#A855F7', 2.2); txt(ctx, value, x, y + 11, 24, '#FFFFFF', true, 'center'); ctx.restore();
}

// ============================================================================
// LEGACY PUBLIC PANEL HELPERS
// ============================================================================

export function drawGamePanel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, radius = 20, fillColor = '#251036', bevelColor = '#0C0413', bevelHeight = 6, strokeColor?: string | null): void {
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.48)'; ctx.shadowBlur = 15; ctx.shadowOffsetY = bevelHeight; rr(ctx, x, y + bevelHeight, w, h, radius, bevelColor); ctx.restore(); rr(ctx, x, y, w, h, radius, fillColor, strokeColor ?? '#A855F7', 2);
}

export function drawRibbonBanner(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, title: string, sub: string, angle = 0): void {
  ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(angle); ctx.translate(-w / 2, -h / 2); drawGamePanel(ctx, 0, 0, w, h, 16, '#35104C', '#11061A', 6, '#D946EF'); drawVectorCrown(ctx, w / 2, 18, 28); txt(ctx, title, w / 2, 48, 25, P.white, true, 'center'); caps(ctx, sub, w / 2, 67, 9, P.lavender, 'center', 1.4); ctx.restore();
}

// ============================================================================
// HIGH-LEVEL R3V0 UI COMPONENTS
// ============================================================================

function fantasyBackground(ctx: SKRSContext2D, w: number, h: number, assets?: ClanAssets): void {
  ctx.fillStyle = '#08020F'; ctx.fillRect(0, 0, w, h);
  drawCover(ctx, assets?.background ?? null, 0, 0, w, h, .34);
  const veil = ctx.createLinearGradient(0, 0, 0, h);
  veil.addColorStop(0, 'rgba(7,1,16,.45)');
  veil.addColorStop(.46, 'rgba(9,2,19,.56)');
  veil.addColorStop(1, 'rgba(4,1,9,.86)');
  ctx.fillStyle = veil; ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(w * .5, h * .29, 10, w * .5, h * .29, 460);
  glow.addColorStop(0, 'rgba(217,70,239,.11)'); glow.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
  // Only subtle global decoration. Heavy ornaments belong in the hero card.
  drawContain(ctx, assets?.headerOrnament ?? null, w / 2 - 250, -18, 500, 120, .12);
}

function outlinedTitle(ctx: SKRSContext2D, main: string, sub: string, x: number, y: number): void {
  ctx.save(); const mainSize = 70; ctx.font = `800 ${mainSize}px ${DISPLAY}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round'; ctx.strokeStyle = '#09020F'; ctx.lineWidth = 14; ctx.strokeText(main, x, y);
  ctx.strokeStyle = '#A855F7'; ctx.lineWidth = 6; ctx.strokeText(main, x, y); ctx.fillStyle = '#FFF9FF'; ctx.shadowColor = '#D946EF'; ctx.shadowBlur = 18; ctx.fillText(main, x, y); ctx.restore();
  drawVectorCrown(ctx, x + 118, y - 78, 58, '#FFF9FF', '#A855F7', 3);
  ctx.save(); ctx.font = `800 37px ${DISPLAY}`; ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#09020F'; ctx.lineWidth = 9; ctx.strokeText(sub, x, y + 48); ctx.strokeStyle = '#A855F7'; ctx.lineWidth = 4; ctx.strokeText(sub, x, y + 48); ctx.fillStyle = '#F5D0FE'; ctx.fillText(sub, x, y + 48); ctx.restore();
  caps(ctx, 'CLAN MEMBER STATS & HISTORY', x + 2, y + 76, 9, '#C9A7DB', 'left', 2.4);
}

function fantasyPanel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r = 23, accent = P.purple2): void {
  // deep shadow
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.62)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 7; rr(ctx, x, y + 4, w, h, r, '#08030E'); ctx.restore();
  // glow
  ctx.save(); ctx.shadowColor = accent; ctx.shadowBlur = 10; rr(ctx, x, y, w, h, r, '#15081F', 'rgba(233,213,255,.62)', 1.6); ctx.restore();
  // outer purple rail
  rr(ctx, x + 4, y + 4, w - 8, h - 8, r - 4, null, 'rgba(168,85,247,.82)', 2.4);
  rr(ctx, x + 11, y + 11, w - 22, h - 22, r - 9, grad(ctx, x, y, x + w, y + h, [[0, '#21102B'], [.42, '#170A20'], [1, '#281035']]), 'rgba(240,171,252,.24)', 1);
  // top gloss
  const shine = ctx.createLinearGradient(0, y + 11, 0, y + 60); shine.addColorStop(0, 'rgba(255,255,255,.12)'); shine.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = shine; roundedPath(ctx, x + 12, y + 12, w - 24, h - 24, r - 10); ctx.fill();
  // corner cuts
  polygon(ctx, [[x + 9, y + 9], [x + 31, y + 9], [x + 9, y + 31]], '#F5D0FE'); polygon(ctx, [[x + w - 9, y + 9], [x + w - 31, y + 9], [x + w - 9, y + 31]], '#F5D0FE');
}

function iconHex(ctx: SKRSContext2D, x: number, y: number, kind: 'star' | 'rank' | 'share' | 'performance' | 'player'): void {
  const r = 31; const pts: [number, number][] = []; for (let i = 0; i < 6; i++) { const a = (-90 + i * 60) * Math.PI / 180; pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); }
  polygon(ctx, pts, '#32104A', '#E9D5FF', 2); if (kind === 'star' || kind === 'player') drawVectorStar(ctx, x, y, 13, '#FFFFFF', '#C084FC', 1.5);
  if (kind === 'rank') drawVectorCrown(ctx, x, y, 31, '#FFFFFF', '#D946EF', 1.6);
  if (kind === 'share') drawCrystal(ctx, x, y, 16, 36);
  if (kind === 'performance') drawVectorBars(ctx, x - 15, y - 14, 31, 29, '#F0ABFC');
}

function panelHeader(ctx: SKRSContext2D, x: number, y: number, title: string, kind: 'star' | 'rank' | 'share' | 'performance' | 'player', assets?: ClanAssets): void {
  const map: Record<typeof kind, number> = { rank: 0, star: 1, share: 2, performance: 3, player: 4 };
  if (assets?.icons) drawAtlasIcon(ctx, assets.icons, map[kind], x + 20, y + 18, 46, .88); else iconHex(ctx, x + 44, y + 43, kind);
  txt(ctx, title, x + 78, y + 52, 27, '#FFF7FF', true); drawSparkle(ctx, x + 78 + Math.min(250, title.length * 16), y + 26, 5, '#F0ABFC', .85);
}

function drawPanelAssetOverlay(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, assets?: ClanAssets, chart = false): void {
  if (!assets) return;
  ctx.save();
  roundedPath(ctx, x + 11, y + 11, w - 22, h - 22, 15);
  ctx.clip();
  drawCover(ctx, assets.panelTexture, x + 11, y + 11, w - 22, h - 22, chart ? .035 : .025);
  ctx.restore();
  // No full-size ornamental frame here: it was the main source of visual clutter.
  if (chart) {
    drawContain(ctx, assets.crystals, x + 10, y + h - 74, 64, 64, .20);
    drawContainFlipped(ctx, assets.crystals, x + w - 74, y + h - 74, 64, 64, true, .20);
  }
}

function drawCircleAvatar(ctx: SKRSContext2D, img: Image | null, cx: number, cy: number, r: number): void {
  ctx.save(); ctx.shadowColor = '#D946EF'; ctx.shadowBlur = 20; ctx.beginPath(); ctx.arc(cx, cy, r + 8, 0, Math.PI * 2); ctx.fillStyle = '#21092F'; ctx.fill(); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r + 2, 0, Math.PI * 2); ctx.fillStyle = '#100518'; ctx.fill(); ctx.strokeStyle = '#F0ABFC'; ctx.lineWidth = 4; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r - 7, 0, Math.PI * 2); ctx.strokeStyle = '#A855F7'; ctx.lineWidth = 3; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r - 11, 0, Math.PI * 2); ctx.clip();
  if (img) {
    const f = Math.max((r * 2 - 12) / img.width, (r * 2 - 12) / img.height); const dw = img.width * f, dh = img.height * f;
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
  } else { ctx.fillStyle = '#2B0D3D'; ctx.fillRect(cx-r, cy-r, r*2, r*2); }
  ctx.restore();
}

function playerPanel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, title: string, tag: string, rank: number | null, activity: number | null, avatar: Image | null, assets?: ClanAssets): void {
  fantasyPanel(ctx, x, y, w, h); drawPanelAssetOverlay(ctx, x, y, w, h, assets); panelHeader(ctx, x, y, 'PLAYER', 'player', assets);
  drawCircleAvatar(ctx, avatar, x + 94, y + 101, 48);
  txt(ctx, title || 'Player', x + 160, y + 91, fitText(ctx, title || 'Player', w - 190, 31), '#FFF8FF', true);
  caps(ctx, `@${(title || 'player').replace(/\s+/g, '')}  •  ${tag ? `[${tag}]` : '[NO CLAN]'}`, x + 160, y + 120, 9, '#D5B8E3', 'left', 1.1);
  caps(ctx, 'CLAN RANK', x + 160, y + 157, 9, '#B895CA', 'left', 1.6); txt(ctx, rank ? `#${rank}` : '—', x + 247, y + 158, 13, '#F5D0FE', true);
  const ay = y + h - 31; rr(ctx, x + 160, ay - 7, w - 194, 9, 5, '#371047'); if (activity !== null) rr(ctx, x + 160, ay - 7, (w - 194) * Math.max(0, Math.min(1, activity)), 9, 5, grad(ctx, x + 160, ay, x + w - 34, ay, [[0, '#A855F7'], [1, '#F472F6']]));
  caps(ctx, activity === null ? 'NO ACTIVITY DATA' : `${Math.round(activity * 100)}% ACTIVITY`, x + w - 32, ay + 2, 8, '#E9D5FF', 'right', 1.1);
}

function starsPanel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, current: number | null, gain: number | null, window: string, assets?: ClanAssets): void {
  fantasyPanel(ctx, x, y, w, h); drawPanelAssetOverlay(ctx, x, y, w, h, assets); panelHeader(ctx, x, y, 'CURRENT STARS', 'star', assets);
  drawVectorStar(ctx, x + 117, y + 132, 35, '#E879F9', '#FFFFFF', 2); txt(ctx, current === null ? '—' : fmt(current), x + 178, y + 148, 59, '#FFF8FF', true);
  const g = gain ?? 0; rr(ctx, x + w - 138, y + 100, 104, 34, 16, g > 0 ? '#064E3B' : '#241033', g > 0 ? '#5EEAD4' : '#A855F7', 1.5); txt(ctx, `${g >= 0 ? '+' : ''}${fmt(g)}`, x + w - 86, y + 123, 15, g > 0 ? '#99F6E4' : '#D8B4FE', true, 'center');
  caps(ctx, `${window.toUpperCase()} OBSERVED`, x + 87, y + h - 34, 9, '#C7A8D6', 'left', 1.8); drawContain(ctx, assets?.crystals ?? null, x + w - 74, y + h - 73, 58, 58, .30);
}

function clanPositionPanel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, rank: number | null, members: number | null, lead: number | null, assets?: ClanAssets): void {
  fantasyPanel(ctx, x, y, w, h); drawPanelAssetOverlay(ctx, x, y, w, h, assets); panelHeader(ctx, x, y, 'CLAN POSITION', 'rank', assets);
  txt(ctx, rank ? `#${rank}` : '—', x + 70, y + 147, 79, '#FFF8FF', true); caps(ctx, members ? `OF ${members} MEMBERS` : 'RANK UNAVAILABLE', x + 217, y + 128, 10, '#D1B6DF', 'left', 1.6);
  caps(ctx, lead !== null ? `LEAD +${fmt(lead)}` : 'NO LEAD DATA', x + 217, y + 158, 10, '#F0ABFC', 'left', 1.6); drawVectorCrown(ctx, x + w - 62, y + 48, 44, '#F3E8FF', '#D946EF', 2);
}

function contributionPanel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, share: number | null, clanTotal: number | null, assets?: ClanAssets): void {
  fantasyPanel(ctx, x, y, w, h); drawPanelAssetOverlay(ctx, x, y, w, h, assets); panelHeader(ctx, x, y, 'CONTRIBUTION', 'share', assets);
  const pct = share ?? 0; drawVectorPieChart(ctx, x + 115, y + 130, 56, pct); txt(ctx, share === null ? '—' : `${Math.round(share)}%`, x + 115, y + 141, 43, '#FFFFFF', true, 'center'); caps(ctx, 'OF CLAN', x + 115, y + 167, 8, '#D6B9E1', 'center', 1.6);
  txt(ctx, clanTotal === null ? '—' : fmt(clanTotal), x + 215, y + 130, 45, '#FFF8FF', true); caps(ctx, 'CLAN TOTAL', x + 217, y + 158, 9, '#D5B8E3', 'left', 1.7); drawContain(ctx, assets?.coins ?? null, x + w - 102, y + h - 72, 74, 58, .40);
}

function performancePanel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, current: number | null, gain: number | null, average: number | null, best: number | null, pace: number | null, consistency: number | null, assets?: ClanAssets): void {
  fantasyPanel(ctx, x, y, w, h); drawPanelAssetOverlay(ctx, x, y, w, h, assets); panelHeader(ctx, x, y, 'PERFORMANCE', 'performance', assets);
  rr(ctx, x + w - 143, y + 18, 112, 29, 15, '#0A4B46', '#5EEAD4', 1.4); txt(ctx, pace === null ? '—' : `${fmt(pace)}/H`, x + w - 87, y + 38, 13, '#99F6E4', true, 'center');
  const rows = [
    ['TOTAL STARS', current === null ? '—' : fmt(current)], ['TOTAL GAIN', gain === null ? '—' : `+${fmt(gain)}`], ['AVG / HOUR', average === null ? '—' : fmt(average)], ['BEST GAIN', best === null ? '—' : fmt(best)],
  ] as const;
  rows.forEach((r, i) => { const yy = y + 92 + i * 43; line(ctx, x + 39, yy + 17, x + w - 28, yy + 17, 'rgba(216,180,254,.18)'); caps(ctx, r[0], x + 39, yy, 9, '#CFB1DC', 'left', 1.4); txt(ctx, r[1], x + w - 34, yy + 2, 23, '#FFF8FF', true, 'right'); });
  caps(ctx, 'CONSISTENCY', x + 39, y + h - 22, 8, '#CFB1DC', 'left', 1.3); const c = consistency ?? 0; rr(ctx, x + 145, y + h - 30, w - 185, 8, 4, '#351044'); rr(ctx, x + 145, y + h - 30, (w - 185) * c, 8, 4, '#D946EF'); caps(ctx, consistency === null ? '—' : `${Math.round(c * 100)}%`, x + w - 29, y + h - 22, 8, '#F5D0FE', 'right', 1.1);
}

// ============================================================================
// AVATAR LOADING / CACHE
// ============================================================================

interface CacheItem<T> { value: T; expires: number }
const imageCache = new Map<string, CacheItem<Image>>();
const pendingImages = new Map<string, Promise<Image | null>>();
const avatarUrlCache = new Map<number, CacheItem<string | null>>();
const pendingAvatars = new Map<number, Promise<string | null>>();

function cachePut<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key); map.set(key, value); while (map.size > max) map.delete(map.keys().next().value!);
}

async function fetchImage(url: string): Promise<Image | null> {
  try {
    const u = new URL(url); if (!['https:', 'http:'].includes(u.protocol)) return null;
    const res = await fetch(u, { signal: AbortSignal.timeout(15_000) }); if (!res.ok || !res.body) return null;
    const ct = res.headers.get('content-type') ?? ''; if (!ct.startsWith('image/')) return null;
    const reader = res.body.getReader(); const chunks: Uint8Array[] = []; let len = 0; const limit = 8 * 1024 * 1024;
    try { while (true) { const n = await reader.read(); if (n.done) break; len += n.value.byteLength; if (len > limit) { await reader.cancel(); return null; } chunks.push(n.value); } } finally { reader.releaseLock(); }
    const img = await loadImage(Buffer.concat(chunks)); return img.width > 0 && img.height > 0 ? img : null;
  } catch { return null; }
}

async function loadRemote(url: string | null | undefined): Promise<Image | null> {
  if (!url) return null; const hit = imageCache.get(url); if (hit && hit.expires > Date.now()) return hit.value; if (pendingImages.has(url)) return pendingImages.get(url)!;
  const p = fetchImage(url).then(img => { if (img) cachePut(imageCache, url, { value: img, expires: Date.now() + 300_000 }, 40); return img; }).finally(() => pendingImages.delete(url)); pendingImages.set(url, p); return p;
}

function validId(v: unknown): number | null { const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN; return Number.isSafeInteger(n) && n > 0 ? n : null; }
function idFromAvatarUrl(url: string | null): number | null { if (!url) return null; try { const u = new URL(url); return validId(u.searchParams.get('userId') ?? u.searchParams.get('userIds')); } catch { return null; } }

async function fullBodyUrl(userId: number): Promise<string | null> {
  const hit = avatarUrlCache.get(userId); if (hit && hit.expires > Date.now()) return hit.value; if (pendingAvatars.has(userId)) return pendingAvatars.get(userId)!;
  const p = (async () => { try {
    const res = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png&isCircular=false`, { signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json' } });
    if (!res.ok) return null; const body = await res.json() as { data?: { targetId?: number; state?: string; imageUrl?: string }[] };
    const row = body.data?.find(e => e.targetId === userId && e.state === 'Completed'); return row?.imageUrl ?? null;
  } catch { return null; } })().then(v => { cachePut(avatarUrlCache, userId, { value: v, expires: Date.now() + (v ? 300_000 : 15_000) }, 256); return v; }).finally(() => pendingAvatars.delete(userId));
  pendingAvatars.set(userId, p); return p;
}

async function playerImage(userId: number | null, avatarUrl: string | null, override?: string | null): Promise<Image | null> {
  if (override) { const i = await loadRemote(override); if (i) return i; }
  if (userId) { const url = await fullBodyUrl(userId); if (url) { const i = await loadRemote(url); if (i) return i; } }
  return loadRemote(avatarUrl);
}

interface Bounds { x: number; y: number; w: number; h: number }
const boundsCache = new WeakMap<Image, Bounds>();
function opaqueBounds(img: Image): Bounds {
  const hit = boundsCache.get(img); if (hit) return hit; const c = createCanvas(192, 192), cc = c.getContext('2d'); cc.drawImage(img, 0, 0, 192, 192); const d = cc.getImageData(0, 0, 192, 192).data;
  let minX = 192, minY = 192, maxX = -1, maxY = -1; for (let y = 0; y < 192; y++) for (let x = 0; x < 192; x++) if (d[(y * 192 + x) * 4 + 3]! > 20) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const out = maxX < 0 ? { x: 0, y: 0, w: img.width, h: img.height } : { x: minX / 192 * img.width, y: minY / 192 * img.height, w: (maxX - minX + 1) / 192 * img.width, h: (maxY - minY + 1) / 192 * img.height }; boundsCache.set(img, out); return out;
}

function drawStickerAvatar(ctx: SKRSContext2D, img: Image | null, x: number, y: number, w: number, h: number): void {
  if (!img) { drawMascot(ctx, x + w / 2, y + h / 2, Math.min(w, h) * .42, 'cube', .8); caps(ctx, 'AVATAR UNAVAILABLE', x + w / 2, y + h - 40, 10, '#E9D5FF', 'center', 1.4); return; }
  const b = opaqueBounds(img); const f = Math.min(w / b.w, h / b.h); const dw = b.w * f, dh = b.h * f; const dx = x + (w - dw) / 2, dy = y + h - dh;
  const pad = 22; const m = createCanvas(Math.ceil(dw + pad * 2), Math.ceil(dh + pad * 2)), mc = m.getContext('2d'); mc.drawImage(img, b.x, b.y, b.w, b.h, pad, pad, dw, dh); mc.globalCompositeOperation = 'source-in'; mc.fillStyle = '#FFFFFF'; mc.fillRect(0, 0, m.width, m.height);
  // black cartoon outer outline
  ctx.save(); ctx.globalAlpha = .95; ctx.shadowColor = '#050108'; ctx.shadowBlur = 3; for (const [ox, oy] of [[-7,0],[7,0],[0,-7],[0,7],[-5,-5],[5,5],[-5,5],[5,-5]] as const) ctx.drawImage(m, dx - pad + ox, dy - pad + oy); ctx.restore();
  // purple glow outline
  ctx.save(); ctx.globalAlpha = .75; ctx.shadowColor = '#D946EF'; ctx.shadowBlur = 23; for (const [ox, oy] of [[-3,0],[3,0],[0,-3],[0,3]] as const) ctx.drawImage(m, dx - pad + ox, dy - pad + oy); ctx.restore();
  // pale inner edge
  ctx.save(); ctx.globalAlpha = .4; for (const [ox, oy] of [[-1.5,0],[1.5,0],[0,-1.5],[0,1.5]] as const) ctx.drawImage(m, dx - pad + ox, dy - pad + oy); ctx.restore();
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.72)'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 11; ctx.drawImage(img, b.x, b.y, b.w, b.h, dx, dy, dw, dh); ctx.restore();
  // purple/cyan clipped color pass
  const ov = createCanvas(m.width, m.height), oc = ov.getContext('2d'); oc.drawImage(m, 0, 0); oc.globalCompositeOperation = 'source-in'; const gg = oc.createLinearGradient(0, 0, ov.width, ov.height); gg.addColorStop(0, 'rgba(216,70,239,.19)'); gg.addColorStop(.52, 'rgba(255,255,255,0)'); gg.addColorStop(1, 'rgba(103,232,249,.10)'); oc.fillStyle = gg; oc.fillRect(0, 0, ov.width, ov.height); ctx.globalAlpha = .95; ctx.drawImage(ov, dx - pad, dy - pad); ctx.globalAlpha = 1;
}

function heroCard(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, title: string, tag: string, rank: number | null, assets?: ClanAssets): void {
  fantasyPanel(ctx, x, y, w, h, 28, '#D946EF');
  ctx.save();
  roundedPath(ctx, x + 16, y + 16, w - 32, h - 32, 20); ctx.clip();
  drawCover(ctx, assets?.background ?? null, x + 16, y + 16, w - 32, h - 32, .28);
  ctx.fillStyle = 'rgba(18,4,31,.56)'; ctx.fillRect(x + 16, y + 16, w - 32, h - 32);

  // Tall architectural accents stay close to the edges.
  drawContainFlipped(ctx, assets?.pillar ?? null, x + 8, y + 92, 116, 320, false, .24);
  drawContainFlipped(ctx, assets?.pillar ?? null, x + w - 124, y + 92, 116, 320, true, .24);

  // Clan logo is the focal point.
  drawContain(ctx, assets?.logo ?? null, x + 126, y + 82, w - 252, 292, .98);

  // Three restrained accents, not a full collage.
  drawContain(ctx, assets?.angel ?? null, x + 45, y + 145, 92, 92, .72);
  drawContain(ctx, assets?.bat ?? null, x + w - 137, y + 150, 92, 92, .72);
  drawContain(ctx, assets?.platform ?? null, x + 135, y + h - 225, w - 270, 112, .72);
  drawContain(ctx, assets?.crystals ?? null, x + 26, y + h - 208, 118, 142, .52);
  drawContainFlipped(ctx, assets?.crystals ?? null, x + w - 144, y + h - 208, 118, 142, true, .52);
  ctx.restore();

  // Frame is now a light accent only.
  drawContain(ctx, assets?.frameMain ?? null, x + 4, y + 4, w - 8, h - 8, .22);
  drawCrownBadge(ctx, x + w / 2, y + 23, rank ? `#${rank}` : '#—');

  rr(ctx, x + 94, y + h - 111, w - 188, 72, 18, 'rgba(47,12,73,.94)', 'rgba(240,171,252,.72)', 1.5);
  caps(ctx, 'R3V0 CLAN MEMBER', x + w / 2, y + h - 84, 9, '#E9D5FF', 'center', 1.8);
  txt(ctx, title || 'Player', x + w / 2, y + h - 55, 31, '#FFFFFF', true, 'center');
  rr(ctx, x + w / 2 - 62, y + h - 27, 124, 26, 13, '#160620', 'rgba(216,180,254,.65)', 1);
  caps(ctx, tag ? `[${tag}]` : '[NO CLAN]', x + w / 2, y + h - 9, 8, '#F5D0FE', 'center', 1.4);
}

// ============================================================================
// HISTORY DATA SERIES + CHART
// ============================================================================
// HISTORY DATA SERIES + CHART
// ============================================================================

interface Series { values: (number | null)[]; start: number; end: number; step: number }
function historySeries(points: HistoryPoint[] | null | undefined, totalMs: number, count: number, now: number): Series {
  const arr = (Array.isArray(points) ? points : []).filter(p => p && Number.isFinite(p.ts) && Number.isFinite(p.value) && p.ts <= now).sort((a, b) => a.ts - b.ts);
  const start = now - totalMs, step = totalMs / count; const values: (number | null)[] = Array.from({ length: count }, () => null);
  for (let i = 0; i < count; i++) {
    const lo = start + i * step, hi = lo + step; let a: HistoryPoint | undefined, b: HistoryPoint | undefined;
    for (const p of arr) { if (p.ts <= lo) a = p; if (p.ts <= hi) b = p; else break; }
    if (!a) a = arr.find(p => p.ts >= lo && p.ts <= hi); if (!a || !b || b.ts <= a.ts || b.value < a.value) continue; values[i] = b.value - a.value;
  }
  return { values, start, end: now, step };
}

function num(n: unknown): number | null { return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null; }

function chartPanel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, series: Series, mode: TimeframeMode, assets?: ClanAssets): void {
  fantasyPanel(ctx, x, y, w, h, 26); drawPanelAssetOverlay(ctx, x, y, w, h, assets, true); panelHeader(ctx, x, y, 'CONTRIBUTION HISTORY', 'performance', assets);
  const mins = series.step / 60_000; const interval = mins >= 60 ? `${Number((mins / 60).toFixed(1))}H` : `${Math.round(mins)}M`;
  caps(ctx, `${mode.toUpperCase()} WINDOW  /  ${interval} INTERVAL`, x + w - 30, y + 42, 9, '#E0C6EA', 'right', 1.5);
  const px = x + 82, py = y + 88, pw = w - 124, ph = h - 132, bottom = py + ph;
  const vals = series.values.filter((v): v is number => v !== null); const max = Math.max(...vals, 0);
  const yMax = max > 0 ? max * 1.12 : 1;
  for (let i = 0; i <= 4; i++) { const gy = py + ph * i / 4; line(ctx, px, gy, px + pw, gy, 'rgba(214,162,255,.16)'); txt(ctx, max > 0 ? fmt(yMax * (1 - i / 4)) : (i === 4 ? '0' : ''), px - 13, gy + 4, 10, '#B999C8', false, 'right'); }
  const count = series.values.length; const gap = Math.max(4, Math.min(9, pw / Math.max(1, count) * .18)); const bw = Math.max(7, (pw - gap * (count - 1)) / Math.max(1, count));
  series.values.forEach((v, i) => {
    const value = v ?? 0; const bh = max > 0 ? Math.max(value > 0 ? 4 : 2, value / yMax * (ph - 5)) : 2; const bx = px + i * (bw + gap); const by = bottom - bh;
    ctx.save(); ctx.shadowColor = '#D946EF'; ctx.shadowBlur = value > 0 ? 14 : 4;
    const g = ctx.createLinearGradient(0, by, 0, bottom); g.addColorStop(0, '#F5D0FE'); g.addColorStop(.34, '#D946EF'); g.addColorStop(1, '#6D28D9');
    rr(ctx, bx, by, bw, bh, Math.min(5, bw / 2), g, 'rgba(255,255,255,.64)', 1); ctx.restore();
  });
  if (max > 0) {
    const idx = series.values.indexOf(max); const bx = px + idx * (bw + gap) + bw / 2; const by = bottom - max / yMax * (ph - 5);
    rr(ctx, Math.max(px, Math.min(px + pw - 110, bx - 55)), Math.max(py, by - 34), 110, 27, 9, '#43105F', '#F0ABFC', 1.2); caps(ctx, fmt(max), Math.max(px + 55, Math.min(px + pw - 55, bx)), Math.max(py + 18, by - 16), 9, '#FFFFFF', 'center', 1);
  }
  const hours = (series.end - series.start) / 3_600_000; const ticks = hours <= 6 ? 6 : 8; for (let i = 0; i <= ticks; i++) { const ago = hours * (1 - i / ticks); const label = i === ticks ? 'NOW' : ago >= 1 ? `−${Number(ago.toFixed(1))}h` : `−${Math.round(ago * 60)}m`; txt(ctx, label, px + pw * i / ticks, bottom + 23, 10, i === ticks ? '#F0ABFC' : '#B697C6', false, 'center'); }
  // Small corner accents are handled by drawPanelAssetOverlay().
}

// ============================================================================
// MAIN RENDERERS
// ============================================================================

function eventMeta(subtitle: string, heading?: readonly [string, string]): { tag: string; event: string } {
  const parts = (subtitle ?? '').split(/[•|]/).map(s => s.trim()).filter(Boolean); const tag = (parts[0] ?? '').replace(/[\[\]]/g, '').slice(0, 24); const event = heading?.join(' ') ?? (parts.slice(1).join(' · ') || 'SPACE MINE BATTLE 2026'); return { tag, event };
}

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
  const w = 1600, h = 1000, scale = options.scale === 1 ? 1 : 2; const canvas = createCanvas(w * scale, h * scale), ctx = canvas.getContext('2d'); ctx.scale(scale, scale); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const themeDir = assetDir(options.assetDirectory); registerFonts(themeDir); const [avatar, assets] = await Promise.all([playerImage(validId(userId) ?? idFromAvatarUrl(avatarUrl), avatarUrl, options.avatarRenderUrl), loadClanAssets(themeDir)]);
  const tf = getTimeframeConfig(selectedTimeframe), now = options.now ?? Date.now(), series = historySeries(stats?.points, tf.totalMs, tf.buckets, now), values = series.values.filter((v): v is number => v !== null);
  const current = num(stats?.current); const gain = values.length ? values.reduce((a, b) => a + b, 0) : null; const average = gain === null ? null : gain / (tf.totalMs / 3_600_000); const best = values.length ? Math.max(...values) : null; const last = series.values.at(-1) ?? null; const pace = last === null ? null : last / (series.step / 3_600_000); const consistency = values.length ? values.filter(v => v > 0).length / values.length : null;
  const rank = validId(rivalry?.rank), members = validId(rivalry?.totalMembers), clanTotal = num(rivalry?.clanPoints), userPoints = num(rivalry?.userPoints) ?? current; const share = clanTotal && clanTotal > 0 && userPoints !== null ? Math.min(100, Math.max(0, userPoints / clanTotal * 100)) : null; const lead = rivalry?.behind && num(rivalry.behind.lead) !== null ? num(rivalry.behind.lead) : null; const meta = eventMeta(subtitle, options.heading);

  fantasyBackground(ctx, w, h, assets);
  outlinedTitle(ctx, 'R3V0', 'PLAYER HISTORY', 43, 92);
  caps(ctx, meta.event, 1552, 42, 11, '#E1C7EB', 'right', 2.2); caps(ctx, 'R3V0 / LIVE PLAYER DATA', 1552, 64, 8, '#B992CA', 'right', 2.1);

  // Exact mockup-inspired layout.
  playerPanel(ctx, 28, 200, 454, 187, title, meta.tag, rank, consistency, avatar, assets);
  starsPanel(ctx, 28, 411, 454, 194, current, gain, selectedTimeframe, assets);
  heroCard(ctx, 505, 52, 604, 588, title, meta.tag, rank, assets);
  clanPositionPanel(ctx, 1135, 200, 437, 187, rank, members, lead, assets);
  contributionPanel(ctx, 1135, 411, 437, 194, share, clanTotal, assets);
  chartPanel(ctx, 28, 650, 1088, 308, series, selectedTimeframe, assets);
  performancePanel(ctx, 1143, 650, 429, 308, current, gain, average, best, pace, consistency, assets);

  caps(ctx, meta.tag ? `${meta.tag} / CLAN INTELLIGENCE` : 'R3V0 / CLAN INTELLIGENCE', 58, 985, 8, '#9E7BAD', 'left', 2); caps(ctx, 'PET SIMULATOR 99', 1546, 985, 8, '#9E7BAD', 'right', 2);
  return canvas.encode('png');
}

export async function renderPlayerCard(title: string, subtitle: string, avatarUrl: string | null, userId?: number | null, options: PlayerCardRenderOptions = {}): Promise<Buffer> {
  const w = 640, h = 820, scale = options.scale === 1 ? 1 : 2; const c = createCanvas(w * scale, h * scale), ctx = c.getContext('2d'); ctx.scale(scale, scale); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; registerFonts(assetDir(options.assetDirectory));
  const themeDir = assetDir(options.assetDirectory); const assets = await loadClanAssets(themeDir); const meta = eventMeta(subtitle, options.heading); fantasyBackground(ctx, w, h, assets); outlinedTitle(ctx, 'R3V0', 'PLAYER CARD', 28, 72); heroCard(ctx, 60, 146, 520, 580, title, meta.tag, validId(options.rank), assets); if (options.roleLabel) caps(ctx, options.roleLabel, w / 2, 774, 10, '#E9D5FF', 'center', 2); return c.encode('png');
}

export async function renderRap(r: RapResult): Promise<Buffer> {
  const w = 1200, h = 680, scale = 2; const c = createCanvas(w * scale, h * scale), ctx = c.getContext('2d'); ctx.scale(scale, scale); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; const themeDir = assetDir(); registerFonts(themeDir); const assets = await loadClanAssets(themeDir); fantasyBackground(ctx, w, h, assets); outlinedTitle(ctx, 'R3V0', 'RAP TRACKER', 36, 74);
  fantasyPanel(ctx, 34, 164, 338, 450); fantasyPanel(ctx, 396, 164, 770, 450); const img = await loadRemote(r.imageUrl); if (img) { const b = opaqueBounds(img), f = Math.min(260 / b.w, 260 / b.h); ctx.drawImage(img, b.x, b.y, b.w, b.h, 203 - b.w * f / 2, 340 - b.h * f / 2, b.w * f, b.h * f); } else drawMascot(ctx, 203, 330, 120, 'cube'); txt(ctx, r.name, 203, 515, fitText(ctx, r.name, 285, 32), '#FFFFFF', true, 'center'); caps(ctx, 'PET VALUATION', 203, 545, 9, '#CFB1DC', 'center', 1.8);
  caps(ctx, 'VARIANT', 434, 207, 10, '#D7BDE1', 'left', 1.7); caps(ctx, 'VALUE', 870, 207, 10, '#D7BDE1', 'right', 1.7); caps(ctx, 'CHANGE', 1127, 207, 10, '#D7BDE1', 'right', 1.7);
  const vars = Array.isArray(r.variants) ? r.variants.slice(0, 5) : []; vars.forEach((v, i) => { const yy = 230 + i * 68; rr(ctx, 420, yy, 720, 56, 14, '#1B0B29', 'rgba(216,180,254,.25)', 1); txt(ctx, v.label, 442, yy + 35, 22, '#FFF8FF', true); txt(ctx, num(v.value) === null ? '—' : fmt(v.value), 870, yy + 35, 25, '#FFFFFF', true, 'right'); const d = typeof v.delta === 'number' && Number.isFinite(v.delta) ? v.delta : null; const p = typeof v.deltaPct === 'number' && Number.isFinite(v.deltaPct) ? v.deltaPct : null; const str = d === null ? '—' : `${d >= 0 ? '+' : ''}${fmt(d)}${p === null ? '' : `  ${p >= 0 ? '+' : ''}${p.toFixed(1)}%`}`; txt(ctx, str, 1120, yy + 35, 18, d === null ? '#B697C6' : d >= 0 ? '#5EEAD4' : '#F9A8D4', true, 'right'); });
  caps(ctx, `BASELINE / ${r.baselineLabel}`, 422, 592, 9, '#B999C8', 'left', 1.7); return c.encode('png');
}

// ============================================================================
// BACKWARD COMPATIBILITY EXPORTS
// ============================================================================

export const drawVectorDonut = drawVectorPieChart;

export function drawWoodenPlank(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, text: string, angle = 0): void {
  ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(angle); ctx.translate(-w / 2, -h / 2); drawGamePanel(ctx, 0, 0, w, h, 12, '#32104A', '#09020F', 6, '#D946EF'); txt(ctx, text, w / 2, h / 2 + 7, fitText(ctx, text, w - 20, 16), '#FFF8FF', true, 'center'); ctx.restore();
}

export function drawHangingBanner(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, title: string, lines: string[], angle = 0): void {
  ctx.save(); ctx.translate(x + w / 2, y); ctx.rotate(angle); ctx.translate(-w / 2, 0); polygon(ctx, [[0, 0], [w, 0], [w, h - 16], [w / 2, h + 12], [0, h - 16]], '#32104A', '#D946EF', 2); txt(ctx, title, w / 2, 26, 15, '#FFFFFF', true, 'center'); lines.slice(0, 4).forEach((s, i) => txt(ctx, s, w / 2, 50 + i * 16, 11, '#E9D5FF', false, 'center')); ctx.restore();
}

export function drawChunkyGamePanel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r = 18, bgGradTop = '#381151', bgGradBot = '#1A0827', bevelColor = '#09020F', bevelDepth = 6): void {
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = bevelDepth; rr(ctx, x, y + bevelDepth, w, h, r, bevelColor); ctx.restore(); rr(ctx, x, y, w, h, r, grad(ctx, x, y, x, y + h, [[0, bgGradTop], [1, bgGradBot]]), '#A855F7', 2);
}

export function drawCreamTile(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r = 16): void {
  rr(ctx, x, y, w, h, r, grad(ctx, x, y, x, y + h, [[0, '#FFF8FF'], [1, '#E9D5FF']]), '#A855F7', 2);
}
