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
// HIGH-LEVEL R3V0 UI COMPONENTS — V9 CLEAN STAGE
// ============================================================================

function fantasyBackground(ctx: SKRSContext2D, w: number, h: number, assets?: ClanAssets): void {
  ctx.fillStyle = '#07020D';
  ctx.fillRect(0, 0, w, h);
  drawCover(ctx, assets?.background ?? null, 0, 0, w, h, .52);

  const veil = ctx.createLinearGradient(0, 0, 0, h);
  veil.addColorStop(0, 'rgba(6,1,13,.40)');
  veil.addColorStop(.48, 'rgba(8,2,16,.50)');
  veil.addColorStop(1, 'rgba(5,1,10,.86)');
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, w, h);

  const radial = ctx.createRadialGradient(w * .52, h * .30, 40, w * .52, h * .30, 560);
  radial.addColorStop(0, 'rgba(168,85,247,.15)');
  radial.addColorStop(.55, 'rgba(76,29,149,.045)');
  radial.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * .25, w / 2, h / 2, Math.max(w, h) * .72);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,.58)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function glassCard(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r = 22, accent = '#A855F7'): void {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.58)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 10;
  rr(ctx, x, y, w, h, r, 'rgba(10,4,18,.86)');
  ctx.restore();

  rr(ctx, x, y, w, h, r, 'rgba(18,7,29,.88)', 'rgba(233,213,255,.40)', 1.3);
  rr(ctx, x + 5, y + 5, w - 10, h - 10, r - 5, null, 'rgba(168,85,247,.38)', 1.1);

  const top = ctx.createLinearGradient(0, y, 0, y + 90);
  top.addColorStop(0, 'rgba(255,255,255,.075)');
  top.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.save(); roundedPath(ctx, x + 6, y + 6, w - 12, h - 12, r - 6); ctx.clip(); ctx.fillStyle = top; ctx.fillRect(x + 6, y + 6, w - 12, 96); ctx.restore();

  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 11;
  line(ctx, x + 26, y + 3, x + Math.min(w - 26, 170), y + 3, accent, 2.2);
  ctx.restore();
}

function iconHex(ctx: SKRSContext2D, x: number, y: number, kind: 'star' | 'rank' | 'share' | 'performance' | 'player'): void {
  const r = 22;
  const pts: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (-90 + i * 60) * Math.PI / 180;
    pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
  }
  polygon(ctx, pts, 'rgba(55,16,78,.78)', 'rgba(233,213,255,.55)', 1.3);
  if (kind === 'rank') drawVectorCrown(ctx, x, y, 24, '#FFFFFF', '#D946EF', 1.5);
  else if (kind === 'share') drawCrystal(ctx, x, y, 12, 27);
  else if (kind === 'performance') drawVectorBars(ctx, x - 12, y - 11, 25, 23, '#F0ABFC');
  else drawVectorStar(ctx, x, y, 10, '#FFFFFF', '#C084FC', 1.2);
}

function sectionTitle(ctx: SKRSContext2D, title: string, x: number, y: number, icon: 'star' | 'rank' | 'share' | 'performance' | 'player' = 'player'): void {
  iconHex(ctx, x + 18, y - 7, icon);
  txt(ctx, title, x + 58, y + 3, 22, '#FFF8FF', true);
}

function topHeader(ctx: SKRSContext2D, w: number, meta: { tag: string; event: string }, mode: TimeframeMode, assets?: ClanAssets): void {
  // compact brand mark
  drawContain(ctx, assets?.logo ?? null, 34, 20, 102, 102, .96);
  txt(ctx, 'PLAYER HISTORY', 145, 68, 42, '#FFFFFF', true);
  caps(ctx, 'R3V0 CLAN ANALYTICS', 147, 94, 10, '#D5B8E3', 'left', 2.5);

  // thin ornamental accent, not a full frame
  drawContain(ctx, assets?.headerOrnament ?? null, 575, 16, 420, 80, .11);

  const modeText = `${mode.toUpperCase()} WINDOW`;
  rr(ctx, w - 292, 31, 116, 32, 16, 'rgba(61,20,88,.72)', 'rgba(216,180,254,.48)', 1);
  caps(ctx, modeText, w - 234, 52, 9, '#F5D0FE', 'center', 1.2);
  rr(ctx, w - 164, 31, 120, 32, 16, 'rgba(4,78,72,.45)', 'rgba(94,234,212,.55)', 1);
  caps(ctx, 'LIVE DATA', w - 104, 52, 9, '#99F6E4', 'center', 1.5);

  caps(ctx, meta.event, w - 44, 88, 10, '#E5CEE9', 'right', 1.7);
  caps(ctx, meta.tag ? `[${meta.tag}]` : '[R3V0]', w - 44, 108, 8, '#A98CB8', 'right', 1.5);
  line(ctx, 38, 126, w - 38, 126, 'rgba(216,180,254,.19)', 1);
}

function drawCircleAvatar(ctx: SKRSContext2D, img: Image | null, cx: number, cy: number, r: number): void {
  ctx.save(); ctx.shadowColor = '#D946EF'; ctx.shadowBlur = 22; ctx.beginPath(); ctx.arc(cx, cy, r + 8, 0, Math.PI * 2); ctx.fillStyle = 'rgba(66,19,94,.92)'; ctx.fill(); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r + 1, 0, Math.PI * 2); ctx.fillStyle = '#12051B'; ctx.fill(); ctx.strokeStyle = '#F0ABFC'; ctx.lineWidth = 3.2; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r - 9, 0, Math.PI * 2); ctx.clip();
  if (img) {
    const f = Math.max((r * 2 - 10) / img.width, (r * 2 - 10) / img.height);
    const dw = img.width * f, dh = img.height * f;
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
  } else {
    const g = ctx.createLinearGradient(cx-r, cy-r, cx+r, cy+r); g.addColorStop(0, '#3B1556'); g.addColorStop(1, '#15051E');
    ctx.fillStyle = g; ctx.fillRect(cx-r, cy-r, r*2, r*2);
    drawVectorStar(ctx, cx, cy, r * .42, '#F5D0FE', '#A855F7', 2);
  }
  ctx.restore();
}

function metricChip(ctx: SKRSContext2D, x: number, y: number, w: number, label: string, value: string, accent = '#D946EF'): void {
  rr(ctx, x, y, w, 72, 18, 'rgba(20,8,31,.86)', 'rgba(216,180,254,.20)', 1);
  ctx.fillStyle = accent; rr(ctx, x + 15, y + 15, 4, 42, 2, accent);
  caps(ctx, label, x + 33, y + 29, 8, '#BFA4CE', 'left', 1.6);
  txt(ctx, value, x + 33, y + 56, 24, '#FFF8FF', true);
}

function heroStage(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number,
  title: string, tag: string, rank: number | null, activity: number | null,
  avatar: Image | null,
  current: number | null, gain: number | null, average: number | null,
  assets?: ClanAssets,
): void {
  glassCard(ctx, x, y, w, h, 28, '#D946EF');

  ctx.save();
  roundedPath(ctx, x + 9, y + 9, w - 18, h - 18, 22);
  ctx.clip();
  drawCover(ctx, assets?.background ?? null, x + 9, y + 9, w - 18, h - 18, .20);
  const heroVeil = ctx.createLinearGradient(x, y, x + w, y);
  heroVeil.addColorStop(0, 'rgba(11,4,18,.96)');
  heroVeil.addColorStop(.36, 'rgba(17,6,29,.84)');
  heroVeil.addColorStop(1, 'rgba(15,4,27,.46)');
  ctx.fillStyle = heroVeil; ctx.fillRect(x + 9, y + 9, w - 18, h - 18);
  ctx.restore();

  // LEFT: identity block
  const leftW = 305;
  line(ctx, x + leftW + 4, y + 42, x + leftW + 4, y + h - 104, 'rgba(216,180,254,.18)', 1);
  caps(ctx, 'PLAYER', x + 30, y + 42, 9, '#BFA3CD', 'left', 2.2);
  drawCircleAvatar(ctx, avatar, x + 112, y + 132, 66);
  txt(ctx, title || 'Player', x + 28, y + 230, fitText(ctx, title || 'Player', leftW - 56, 34), '#FFFFFF', true);
  caps(ctx, `@${(title || 'player').replace(/\s+/g, '')}`, x + 30, y + 258, 9, '#D5B8E3', 'left', 1.4);
  rr(ctx, x + 28, y + 282, 118, 30, 15, 'rgba(65,19,92,.70)', 'rgba(216,180,254,.32)', 1);
  caps(ctx, tag ? `[${tag}]` : '[NO CLAN]', x + 87, y + 302, 8, '#F5D0FE', 'center', 1.3);
  rr(ctx, x + 158, y + 282, 118, 30, 15, 'rgba(65,19,92,.70)', 'rgba(216,180,254,.32)', 1);
  caps(ctx, rank ? `RANK #${rank}` : 'RANK —', x + 217, y + 302, 8, '#F5D0FE', 'center', 1.3);

  caps(ctx, 'ACTIVITY', x + 30, y + 349, 8, '#A98DB8', 'left', 1.5);
  rr(ctx, x + 30, y + 360, leftW - 58, 9, 5, 'rgba(68,27,84,.72)');
  const a = Math.max(0, Math.min(1, activity ?? 0));
  if (a > 0) rr(ctx, x + 30, y + 360, (leftW - 58) * a, 9, 5, grad(ctx, x+30, y, x+leftW, y, [[0,'#A855F7'],[1,'#F472F6']]));
  caps(ctx, activity === null ? 'NO DATA' : `${Math.round(a * 100)}%`, x + leftW - 28, y + 350, 8, '#E7D1EE', 'right', 1.2);

  // RIGHT: clan stage — only the key assets
  const sx = x + leftW + 20, sw = w - leftW - 38;
  drawContainFlipped(ctx, assets?.pillar ?? null, sx + 5, y + 56, 92, 280, false, .20);
  drawContainFlipped(ctx, assets?.pillar ?? null, sx + sw - 97, y + 56, 92, 280, true, .20);
  drawContain(ctx, assets?.logo ?? null, sx + 112, y + 48, sw - 224, 270, .97);
  drawContain(ctx, assets?.angel ?? null, sx + 46, y + 126, 82, 82, .72);
  drawContain(ctx, assets?.bat ?? null, sx + sw - 128, y + 132, 82, 82, .72);
  drawContain(ctx, assets?.platform ?? null, sx + 110, y + 284, sw - 220, 100, .72);
  drawContain(ctx, assets?.crystals ?? null, sx + 18, y + 286, 94, 118, .38);
  drawContainFlipped(ctx, assets?.crystals ?? null, sx + sw - 112, y + 286, 94, 118, true, .38);

  // bottom metrics unify the hero
  const my = y + h - 92;
  const mw = (w - 76) / 3;
  metricChip(ctx, x + 24, my, mw, 'CURRENT STARS', current === null ? '—' : fmt(current));
  metricChip(ctx, x + 38 + mw, my, mw, 'WINDOW GAIN', gain === null ? '—' : `${gain >= 0 ? '+' : ''}${fmt(gain)}`, '#F472F6');
  metricChip(ctx, x + 52 + mw * 2, my, mw, 'AVG / HOUR', average === null ? '—' : fmt(average), '#67E8F9');
}

function rankCard(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, rank: number | null, members: number | null, lead: number | null): void {
  glassCard(ctx, x, y, w, h, 22, '#C084FC');
  sectionTitle(ctx, 'CLAN POSITION', x + 24, y + 42, 'rank');
  txt(ctx, rank ? `#${rank}` : '—', x + 28, y + 120, 72, '#FFF8FF', true);
  caps(ctx, members ? `OF ${members} MEMBERS` : 'MEMBERS —', x + 210, y + 86, 9, '#C9AED9', 'left', 1.5);
  caps(ctx, lead !== null ? `LEAD +${fmt(lead)}` : 'LEAD —', x + 210, y + 116, 9, '#F0ABFC', 'left', 1.5);
  drawVectorCrown(ctx, x + w - 58, y + 45, 42, '#FFFFFF', '#D946EF', 2);
}

function contributionCard(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, share: number | null, clanTotal: number | null, assets?: ClanAssets): void {
  glassCard(ctx, x, y, w, h, 22, '#D946EF');
  sectionTitle(ctx, 'CONTRIBUTION', x + 24, y + 42, 'share');
  drawVectorPieChart(ctx, x + 98, y + 106, 45, share ?? 0);
  txt(ctx, share === null ? '—' : `${Math.round(share)}%`, x + 98, y + 116, 29, '#FFFFFF', true, 'center');
  caps(ctx, 'OF CLAN', x + 98, y + 143, 8, '#BFA4CE', 'center', 1.4);
  txt(ctx, clanTotal === null ? '—' : fmt(clanTotal), x + 183, y + 105, 40, '#FFF8FF', true);
  caps(ctx, 'CLAN TOTAL', x + 185, y + 137, 9, '#C9AED9', 'left', 1.5);
  drawContain(ctx, assets?.coins ?? null, x + w - 104, y + 70, 78, 64, .32);
}

function performanceCard(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, gain: number | null, average: number | null, best: number | null, pace: number | null, consistency: number | null): void {
  glassCard(ctx, x, y, w, h, 22, '#67E8F9');
  sectionTitle(ctx, 'PERFORMANCE', x + 24, y + 42, 'performance');
  const items = [
    ['GAIN', gain === null ? '—' : `${gain >= 0 ? '+' : ''}${fmt(gain)}`],
    ['AVG / H', average === null ? '—' : fmt(average)],
    ['BEST', best === null ? '—' : fmt(best)],
    ['PACE', pace === null ? '—' : `${fmt(pace)}/H`],
  ] as const;
  items.forEach((it, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const xx = x + 28 + col * 215, yy = y + 84 + row * 58;
    caps(ctx, it[0], xx, yy, 8, '#AFA0BA', 'left', 1.4);
    txt(ctx, it[1], xx, yy + 27, 22, '#FFF8FF', true);
  });
  const c = Math.max(0, Math.min(1, consistency ?? 0));
  caps(ctx, 'CONSISTENCY', x + 28, y + h - 24, 8, '#BFA4CE', 'left', 1.4);
  rr(ctx, x + 138, y + h - 31, w - 198, 8, 4, 'rgba(69,30,82,.75)');
  if (c > 0) rr(ctx, x + 138, y + h - 31, (w - 198) * c, 8, 4, '#A855F7');
  caps(ctx, consistency === null ? '—' : `${Math.round(c * 100)}%`, x + w - 28, y + h - 24, 8, '#E9D5FF', 'right', 1.2);
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

function heroCard(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, title: string, tag: string, rank: number | null, assets?: ClanAssets, avatar: Image | null = null): void {
  glassCard(ctx, x, y, w, h, 28, '#D946EF');
  drawContain(ctx, assets?.logo ?? null, x + 170, y + 26, w - 340, 126, .92);
  drawCircleAvatar(ctx, avatar, x + w / 2, y + 258, 96);
  drawContain(ctx, assets?.angel ?? null, x + 62, y + 225, 92, 92, .56);
  drawContain(ctx, assets?.bat ?? null, x + w - 154, y + 225, 92, 92, .56);
  drawContain(ctx, assets?.platform ?? null, x + 118, y + 342, w - 236, 88, .56);
  txt(ctx, title || 'Player', x + w / 2, y + 470, fitText(ctx, title || 'Player', w - 120, 36), '#FFFFFF', true, 'center');
  caps(ctx, tag ? `[${tag}]` : '[NO CLAN]', x + w / 2, y + 500, 9, '#D9C1E4', 'center', 1.5);
  rr(ctx, x + w / 2 - 70, y + 524, 140, 34, 17, 'rgba(66,19,94,.74)', 'rgba(216,180,254,.42)', 1);
  caps(ctx, rank ? `CLAN RANK #${rank}` : 'CLAN RANK —', x + w / 2, y + 546, 9, '#F5D0FE', 'center', 1.4);
  drawContain(ctx, assets?.crystals ?? null, x + 18, y + h - 118, 112, 110, .30);
  drawContainFlipped(ctx, assets?.crystals ?? null, x + w - 130, y + h - 118, 112, 110, true, .30);
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
  glassCard(ctx, x, y, w, h, 24, '#A855F7');
  txt(ctx, 'CONTRIBUTION HISTORY', x + 30, y + 46, 27, '#FFF8FF', true);
  const mins = series.step / 60_000;
  const interval = mins >= 60 ? `${Number((mins / 60).toFixed(1))}H` : `${Math.round(mins)}M`;
  caps(ctx, `${mode.toUpperCase()} WINDOW  •  ${interval} INTERVAL`, x + w - 30, y + 43, 9, '#D5B8E3', 'right', 1.5);

  const px = x + 72, py = y + 78, pw = w - 112, ph = h - 124, bottom = py + ph;
  const vals = series.values.filter((v): v is number => v !== null);
  const max = Math.max(...vals, 0);
  const yMax = max > 0 ? max * 1.15 : 1;

  for (let i = 0; i <= 4; i++) {
    const gy = py + ph * i / 4;
    line(ctx, px, gy, px + pw, gy, 'rgba(216,180,254,.12)');
    txt(ctx, max > 0 ? fmt(yMax * (1 - i / 4)) : (i === 4 ? '0' : ''), px - 12, gy + 4, 10, '#9F83AE', false, 'right');
  }

  const count = Math.max(1, series.values.length);
  const slot = pw / count;
  const bw = Math.max(8, Math.min(27, slot * .54));
  series.values.forEach((raw, i) => {
    const value = raw ?? 0;
    const bh = max > 0 ? Math.max(value > 0 ? 5 : 2, (value / yMax) * (ph - 4)) : 2;
    const bx = px + slot * i + (slot - bw) / 2;
    const by = bottom - bh;
    const g = ctx.createLinearGradient(0, by, 0, bottom);
    g.addColorStop(0, '#F5D0FE'); g.addColorStop(.24, '#E879F9'); g.addColorStop(.60, '#A855F7'); g.addColorStop(1, '#5B21B6');
    ctx.save();
    ctx.shadowColor = value > 0 ? '#D946EF' : 'rgba(168,85,247,.25)';
    ctx.shadowBlur = value > 0 ? 12 : 3;
    rr(ctx, bx, by, bw, bh, Math.min(6, bw / 2), g, value > 0 ? 'rgba(255,255,255,.46)' : 'rgba(216,180,254,.12)', 1);
    ctx.restore();
  });

  if (max > 0) {
    const idx = series.values.indexOf(max);
    const bx = px + slot * idx + slot / 2;
    const by = bottom - (max / yMax) * (ph - 4);
    rr(ctx, Math.max(px, Math.min(px + pw - 108, bx - 54)), Math.max(py, by - 34), 108, 26, 9, 'rgba(69,16,96,.92)', '#F0ABFC', 1);
    caps(ctx, fmt(max), Math.max(px + 54, Math.min(px + pw - 54, bx)), Math.max(py + 18, by - 16), 8, '#FFFFFF', 'center', 1);
  }

  const hours = (series.end - series.start) / 3_600_000;
  const ticks = hours <= 6 ? 6 : 8;
  for (let i = 0; i <= ticks; i++) {
    const ago = hours * (1 - i / ticks);
    const label = i === ticks ? 'NOW' : ago >= 1 ? `−${Number(ago.toFixed(1))}h` : `−${Math.round(ago * 60)}m`;
    txt(ctx, label, px + pw * i / ticks, bottom + 24, 10, i === ticks ? '#F0ABFC' : '#9F83AE', false, 'center');
  }

  drawContain(ctx, assets?.crystals ?? null, x + 5, y + h - 66, 64, 60, .16);
  drawContainFlipped(ctx, assets?.crystals ?? null, x + w - 69, y + h - 66, 64, 60, true, .16);
}

// ============================================================================
// MAIN RENDERERS
// ============================================================================

function eventMeta(subtitle: string, heading?: readonly [string, string]): { tag: string; event: string } {
  const parts = (subtitle ?? '').split(/[•|]/).map(s => s.trim()).filter(Boolean);
  const tag = (parts[0] ?? '').replace(/[\[\]]/g, '').slice(0, 24);
  const event = heading?.join(' ') ?? (parts.slice(1).join(' · ') || 'SPACE MINE BATTLE 2026');
  return { tag, event };
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
  const w = 1600, h = 1000, scale = options.scale === 1 ? 1 : 2;
  const canvas = createCanvas(w * scale, h * scale), ctx = canvas.getContext('2d');
  ctx.scale(scale, scale); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';

  const themeDir = assetDir(options.assetDirectory);
  registerFonts(themeDir);
  const [avatar, assets] = await Promise.all([
    playerImage(validId(userId) ?? idFromAvatarUrl(avatarUrl), avatarUrl, options.avatarRenderUrl),
    loadClanAssets(themeDir),
  ]);

  const tf = getTimeframeConfig(selectedTimeframe), now = options.now ?? Date.now();
  const series = historySeries(stats?.points, tf.totalMs, tf.buckets, now);
  const values = series.values.filter((v): v is number => v !== null);
  const current = num(stats?.current);
  const gain = values.length ? values.reduce((a, b) => a + b, 0) : null;
  const average = gain === null ? null : gain / (tf.totalMs / 3_600_000);
  const best = values.length ? Math.max(...values) : null;
  const last = series.values.at(-1) ?? null;
  const pace = last === null ? null : last / (series.step / 3_600_000);
  const consistency = values.length ? values.filter(v => v > 0).length / values.length : null;
  const rank = validId(rivalry?.rank), members = validId(rivalry?.totalMembers);
  const clanTotal = num(rivalry?.clanPoints), userPoints = num(rivalry?.userPoints) ?? current;
  const share = clanTotal && clanTotal > 0 && userPoints !== null ? Math.min(100, Math.max(0, userPoints / clanTotal * 100)) : null;
  const lead = rivalry?.behind && num(rivalry.behind.lead) !== null ? num(rivalry.behind.lead) : null;
  const meta = eventMeta(subtitle, options.heading);

  fantasyBackground(ctx, w, h, assets);
  topHeader(ctx, w, meta, selectedTimeframe, assets);

  heroStage(ctx, 40, 150, 990, 500, title, meta.tag, rank, consistency, avatar, current, gain, average, assets);
  rankCard(ctx, 1055, 150, 505, 150, rank, members, lead);
  contributionCard(ctx, 1055, 320, 505, 150, share, clanTotal, assets);
  performanceCard(ctx, 1055, 490, 505, 160, gain, average, best, pace, consistency);
  chartPanel(ctx, 40, 680, 1520, 280, series, selectedTimeframe, assets);

  caps(ctx, meta.tag ? `${meta.tag} / R3V0` : 'R3V0 / CLAN INTELLIGENCE', 52, 985, 8, '#8E74A0', 'left', 1.6);
  caps(ctx, 'PET SIMULATOR 99', 1548, 985, 8, '#8E74A0', 'right', 1.6);
  return canvas.encode('png');
}

export async function renderPlayerCard(title: string, subtitle: string, avatarUrl: string | null, userId?: number | null, options: PlayerCardRenderOptions = {}): Promise<Buffer> {
  const w = 640, h = 820, scale = options.scale === 1 ? 1 : 2;
  const c = createCanvas(w * scale, h * scale), ctx = c.getContext('2d');
  ctx.scale(scale, scale); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const themeDir = assetDir(options.assetDirectory); registerFonts(themeDir);
  const [avatar, assets] = await Promise.all([
    playerImage(validId(userId) ?? idFromAvatarUrl(avatarUrl), avatarUrl, options.avatarRenderUrl),
    loadClanAssets(themeDir),
  ]);
  const meta = eventMeta(subtitle, options.heading);
  fantasyBackground(ctx, w, h, assets);
  drawContain(ctx, assets.logo, 230, 22, 180, 112, .92);
  heroCard(ctx, 60, 145, 520, 595, title, meta.tag, validId(options.rank), assets, avatar);
  if (options.roleLabel) caps(ctx, options.roleLabel, w / 2, 782, 9, '#E9D5FF', 'center', 1.7);
  return c.encode('png');
}

export async function renderRap(r: RapResult): Promise<Buffer> {
  const w = 1200, h = 680, scale = 2;
  const c = createCanvas(w * scale, h * scale), ctx = c.getContext('2d');
  ctx.scale(scale, scale); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const themeDir = assetDir(); registerFonts(themeDir); const assets = await loadClanAssets(themeDir);
  fantasyBackground(ctx, w, h, assets);
  drawContain(ctx, assets.logo, 34, 22, 130, 92, .92);
  txt(ctx, 'RAP TRACKER', 178, 67, 36, '#FFFFFF', true);
  caps(ctx, 'PET VALUATION / LIVE DATA', 180, 91, 9, '#C9AED9', 'left', 1.9);

  glassCard(ctx, 36, 130, 340, 500, 24, '#D946EF');
  glassCard(ctx, 398, 130, 766, 500, 24, '#A855F7');

  const img = await loadRemote(r.imageUrl);
  if (img) {
    const b = opaqueBounds(img), f = Math.min(250 / b.w, 250 / b.h);
    const dw = b.w * f, dh = b.h * f;
    ctx.drawImage(img, b.x, b.y, b.w, b.h, 206 - dw / 2, 300 - dh / 2, dw, dh);
  } else drawContain(ctx, assets.crystalCat, 96, 190, 220, 220, .72);
  txt(ctx, r.name, 206, 500, fitText(ctx, r.name, 285, 31), '#FFFFFF', true, 'center');
  caps(ctx, 'PET VALUATION', 206, 530, 9, '#C9AED9', 'center', 1.7);
  drawContain(ctx, assets.coins, 112, 540, 188, 78, .24);

  txt(ctx, 'MARKET VARIANTS', 430, 176, 25, '#FFFFFF', true);
  caps(ctx, 'VARIANT', 430, 211, 8, '#BFA4CE', 'left', 1.5);
  caps(ctx, 'VALUE', 880, 211, 8, '#BFA4CE', 'right', 1.5);
  caps(ctx, 'CHANGE', 1128, 211, 8, '#BFA4CE', 'right', 1.5);
  const vars = Array.isArray(r.variants) ? r.variants.slice(0, 5) : [];
  vars.forEach((v, i) => {
    const yy = 228 + i * 68;
    rr(ctx, 424, yy, 714, 54, 14, 'rgba(22,8,34,.74)', 'rgba(216,180,254,.16)', 1);
    txt(ctx, v.label, 444, yy + 34, 20, '#FFF8FF', true);
    txt(ctx, num(v.value) === null ? '—' : fmt(v.value), 880, yy + 34, 22, '#FFFFFF', true, 'right');
    const d = typeof v.delta === 'number' && Number.isFinite(v.delta) ? v.delta : null;
    const p = typeof v.deltaPct === 'number' && Number.isFinite(v.deltaPct) ? v.deltaPct : null;
    const str = d === null ? '—' : `${d >= 0 ? '+' : ''}${fmt(d)}${p === null ? '' : `  ${p >= 0 ? '+' : ''}${p.toFixed(1)}%`}`;
    txt(ctx, str, 1118, yy + 34, 17, d === null ? '#A98DB8' : d >= 0 ? '#5EEAD4' : '#F9A8D4', true, 'right');
  });
  caps(ctx, `BASELINE / ${r.baselineLabel}`, 428, 602, 9, '#A98DB8', 'left', 1.6);
  return c.encode('png');
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
