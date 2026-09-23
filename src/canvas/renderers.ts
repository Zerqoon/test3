import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D, type Image } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { HistoryStats } from '../services/HistoryService.js';
import type { RapResult } from '../services/RapService.js';
import type { HistoryPoint } from '../types.js';

// ============================================================================
// R3V0 PLAYER HISTORY V9 — DIAMOND CLEAN & ALIGNED EDITION
// Purple fantasy / MMORPG clan renderer for Pet Simulator 99 & Roblox.
// All public APIs & legacy exports preserved.
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
// HELPERS & FORMATTERS
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
  if (latestVal <= 0) return { label: 'IDLE', color: '#C4B5FD', glowColor: 'rgba(196,181,253,.35)', badgeBg: 'rgba(76,29,149,.45)', badgeBorder: '#8B5CF6' };
  const ratio = avgVal > 0 ? latestVal / avgVal : 1;
  if (ratio < 0.6) return { label: 'LOW TEMPO', color: '#F9A8D4', glowColor: 'rgba(249,168,212,.38)', badgeBg: 'rgba(131,24,67,.40)', badgeBorder: '#EC4899' };
  if (ratio < 1.3) return { label: 'STEADY', color: '#E9D5FF', glowColor: 'rgba(233,213,255,.36)', badgeBg: 'rgba(88,28,135,.40)', badgeBorder: '#C084FC' };
  if (ratio < 2.5) return { label: 'SURGING', color: '#67E8F9', glowColor: 'rgba(103,232,249,.42)', badgeBg: 'rgba(8,145,178,.30)', badgeBorder: '#22D3EE' };
  return { label: 'OVERCLOCKED', color: '#F0ABFC', glowColor: 'rgba(240,171,252,.50)', badgeBg: 'rgba(147,51,234,.45)', badgeBorder: '#D946EF' };
}

export function getTimeframeConfig(mode: TimeframeMode): { totalMs: number; buckets: number; labels: string[] } {
  switch (mode) {
    case '30m': return { totalMs: 30 * 60_000, buckets: 12, labels: ['25m', '20m', '15m', '10m', '5m', 'NOW'] };
    case '1h':  return { totalMs: 60 * 60_000, buckets: 12, labels: ['50m', '40m', '30m', '20m', '10m', 'NOW'] };
    case '3h':  return { totalMs: 3 * 3_600_000, buckets: 18, labels: ['3h', '2.5h', '2h', '1.5h', '1h', 'NOW'] };
    case '6h':  return { totalMs: 6 * 3_600_000, buckets: 18, labels: ['5h', '4h', '3h', '2h', '1h', 'NOW'] };
    case '12h': return { totalMs: 12 * 3_600_000, buckets: 24, labels: ['12h', '9h', '6h', '3h', '1h', 'NOW'] };
    case '24h':
    default:    return { totalMs: 24 * 3_600_000, buckets: 24, labels: ['-24h', '-21h', '-18h', '-15h', '-12h', '-9h', '-6h', '-3h', 'NOW'] };
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
// STYLING, THEME & FONTS
// ============================================================================

type Paint = SKRSContext2D['fillStyle'];
type Align = 'left' | 'center' | 'right';

const C = {
  bgVoid: '#07020E',
  cardBg: 'rgba(19, 8, 32, 0.88)',
  cardBorder: 'rgba(216, 180, 254, 0.28)',
  cardBorderHighlight: '#D946EF',
  accentPurple: '#A855F7',
  accentPink: '#F472B6',
  accentFuchsia: '#E879F9',
  accentCyan: '#38BDF8',
  accentTeal: '#2DD4BF',
  textLight: '#FAF5FF',
  textMuted: '#C4B5FD',
  textDim: '#8B729E',
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
    ['BarlowCondensed-SemiBold.ttf', 'R3V0Display'],
    ['BarlowCondensed-Medium.ttf', 'R3V0Display'],
    ['Barlow-SemiBold.ttf', 'R3V0Body'],
    ['Barlow-Regular.ttf', 'R3V0Body'],
  ];
  for (const [file, alias] of defs) {
    const p = resolve(directory, 'fonts', file);
    if (existsSync(p)) {
      try { GlobalFonts.registerFromPath(p, alias); } catch { /* fallback to system */ }
    }
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

async function localImage(path: string): Promise<Image | null> {
  try {
    if (!existsSync(path)) return null;
    const img = await loadImage(path);
    return img.width > 0 && img.height > 0 ? img : null;
  } catch { return null; }
}

async function loadClanAssets(directory: string): Promise<ClanAssets> {
  const root = resolve(directory, '..');
  const branding = resolve(root, 'branding');
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

// ============================================================================
// GRAPHICAL & DRAWING PRIMITIVES
// ============================================================================

function roundedPath(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function rr(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number, fill: Paint | null, stroke?: Paint | null, width = 1): void {
  ctx.save();
  roundedPath(ctx, x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
  ctx.restore();
}

function drawContain(ctx: SKRSContext2D, img: Image | null, x: number, y: number, w: number, h: number, alpha = 1): void {
  if (!img) return;
  const f = Math.min(w / img.width, h / img.height);
  const dw = img.width * f, dh = img.height * f;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

function drawContainFlipped(ctx: SKRSContext2D, img: Image | null, x: number, y: number, w: number, h: number, flipX = false, alpha = 1): void {
  if (!img) return;
  const f = Math.min(w / img.width, h / img.height);
  const dw = img.width * f, dh = img.height * f;
  const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (flipX) {
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0, dw, dh);
  } else {
    ctx.drawImage(img, dx, dy, dw, dh);
  }
  ctx.restore();
}

function drawCover(ctx: SKRSContext2D, img: Image | null, x: number, y: number, w: number, h: number, alpha = 1): void {
  if (!img) return;
  const f = Math.max(w / img.width, h / img.height);
  const dw = img.width * f, dh = img.height * f;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

function line(ctx: SKRSContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width = 1): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function polygon(ctx: SKRSContext2D, pts: readonly (readonly [number, number])[], fill: Paint | null, stroke?: string, width = 1): void {
  if (!pts.length) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  pts.slice(1).forEach(p => ctx.lineTo(p[0], p[1]));
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
  ctx.restore();
}

function txt(ctx: SKRSContext2D, value: string, x: number, y: number, size: number, color = C.textLight, bold = false, align: Align = 'left', maxWidth?: number): void {
  ctx.save();
  ctx.font = `${bold ? 700 : 500} ${size}px ${bold ? DISPLAY : BODY}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  if (maxWidth) ctx.fillText(String(value), x, y, maxWidth);
  else ctx.fillText(String(value), x, y);
  ctx.restore();
}

function caps(ctx: SKRSContext2D, value: string, x: number, y: number, size = 11, color = C.textMuted, align: Align = 'left', tracking = 1.8): void {
  ctx.save();
  const t = String(value).toUpperCase();
  ctx.font = `700 ${size}px ${BODY}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  const widths = [...t].map(ch => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + Math.max(0, t.length - 1) * tracking;
  let dx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  [...t].forEach((ch, i) => {
    ctx.fillText(ch, dx, y);
    dx += widths[i]! + tracking;
  });
  ctx.restore();
}

function fitText(ctx: SKRSContext2D, value: string, maxWidth: number, size: number, family = DISPLAY): number {
  ctx.save();
  let s = size;
  while (s > 10) {
    ctx.font = `700 ${s}px ${family}`;
    if (ctx.measureText(value).width <= maxWidth) break;
    s -= 1;
  }
  ctx.restore();
  return s;
}

// ============================================================================
// VECTOR ICONS & EMBELLISHMENTS
// ============================================================================

export function drawVectorStar(ctx: SKRSContext2D, cx: number, cy: number, radius: number, fillColor = '#FFFFFF', strokeColor = '#7C3AED', lineWidth = 2): void {
  ctx.save();
  ctx.fillStyle = fillColor;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (-90 + i * 72) * Math.PI / 180;
    const b = (-54 + i * 72) * Math.PI / 180;
    ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    ctx.lineTo(cx + Math.cos(b) * radius * 0.45, cy + Math.sin(b) * radius * 0.45);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function drawVectorCrown(ctx: SKRSContext2D, cx: number, cy: number, width: number, fillColor = '#FFFFFF', strokeColor = '#8B5CF6', lineWidth = 2): void {
  const h = width * 0.58;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.fillStyle = fillColor;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(cx - width / 2, cy + h / 2);
  ctx.lineTo(cx - width / 2, cy - h * 0.12);
  ctx.lineTo(cx - width * 0.26, cy + h * 0.08);
  ctx.lineTo(cx, cy - h / 2);
  ctx.lineTo(cx + width * 0.26, cy + h * 0.08);
  ctx.lineTo(cx + width / 2, cy - h * 0.12);
  ctx.lineTo(cx + width / 2, cy + h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#D946EF';
  ctx.beginPath();
  ctx.arc(cx, cy + h * 0.15, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawVectorTrophy(ctx: SKRSContext2D, cx: number, cy: number, size: number, fillColor = '#F3E8FF', strokeColor = '#9333EA'): void {
  ctx.save();
  ctx.fillStyle = fillColor;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.4, cy - size * 0.4);
  ctx.lineTo(cx + size * 0.4, cy - size * 0.4);
  ctx.lineTo(cx + size * 0.26, cy + size * 0.06);
  ctx.quadraticCurveTo(cx, cy + size * 0.35, cx - size * 0.26, cy + size * 0.06);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillRect(cx - 3, cy + size * 0.25, 6, size * 0.22);
  rr(ctx, cx - size * 0.28, cy + size * 0.46, size * 0.56, size * 0.14, 3, fillColor, strokeColor, 1.8);
  ctx.restore();
}

export function drawVectorClock(ctx: SKRSContext2D, cx: number, cy: number, radius: number, strokeColor = '#F3E8FF'): void {
  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  line(ctx, cx, cy, cx, cy - radius * 0.55, strokeColor, 2.2);
  line(ctx, cx, cy, cx + radius * 0.45, cy + radius * 0.1, strokeColor, 2.2);
  ctx.restore();
}

export function drawVectorSpeedo(ctx: SKRSContext2D, cx: number, cy: number, radius: number, strokeColor = '#F3E8FF'): void {
  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, Math.PI, 0);
  ctx.stroke();
  line(ctx, cx, cy, cx + radius * 0.52, cy - radius * 0.42, '#F472B6', 2.5);
  ctx.restore();
}

export function drawVectorPieChart(ctx: SKRSContext2D, cx: number, cy: number, radius: number, percentage: number): void {
  const pct = Math.max(0, Math.min(100, percentage));
  ctx.save();
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(56, 18, 82, 0.9)';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  if (pct > 0) {
    const g = ctx.createLinearGradient(cx - radius, cy, cx + radius, cy);
    g.addColorStop(0, '#D946EF');
    g.addColorStop(1, '#38BDF8');
    ctx.strokeStyle = g;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * pct) / 100);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawVectorBars(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, color = '#D946EF'): void {
  const bw = w / 5;
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(x, y + h * 0.55, bw, h * 0.45);
  ctx.fillRect(x + bw * 1.5, y + h * 0.35, bw, h * 0.65);
  ctx.fillRect(x + bw * 3, y + h * 0.1, bw, h * 0.9);
  ctx.restore();
}

export function drawVectorPickaxe(ctx: SKRSContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.55);
  line(ctx, 0, -size * 0.35, 0, size * 0.4, '#C084FC', 3.5);
  ctx.strokeStyle = '#F5D0FE';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(0, -size * 0.3, size * 0.4, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();
  ctx.restore();
}

export function drawVectorHeart(ctx: SKRSContext2D, cx: number, cy: number, size: number, color = '#F472B6'): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy + size * 0.35);
  ctx.bezierCurveTo(cx - size * 0.62, cy - size * 0.08, cx - size * 0.52, cy - size * 0.52, cx, cy - size * 0.18);
  ctx.bezierCurveTo(cx + size * 0.52, cy - size * 0.52, cx + size * 0.62, cy - size * 0.08, cx, cy + size * 0.35);
  ctx.fill();
  ctx.restore();
}

// ============================================================================
// PROCEDURAL FANTASY UI CARDS
// ============================================================================

function glassCard(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r = 20, accent = C.accentPurple, assets?: ClanAssets): void {
  ctx.save();
  // Deep card shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.72)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 10;
  rr(ctx, x, y, w, h, r, C.cardBg);
  ctx.restore();

  // Glass background gradient
  const cardGrad = ctx.createLinearGradient(x, y, x, y + h);
  cardGrad.addColorStop(0, 'rgba(28, 11, 48, 0.92)');
  cardGrad.addColorStop(1, 'rgba(12, 5, 22, 0.96)');
  rr(ctx, x, y, w, h, r, cardGrad, C.cardBorder, 1.2);

  // Texture integration from assets
  if (assets?.panelTexture) {
    ctx.save();
    roundedPath(ctx, x + 2, y + 2, w - 4, h - 4, r - 2);
    ctx.clip();
    ctx.globalAlpha = 0.08;
    ctx.drawImage(assets.panelTexture, x, y, w, h);
    ctx.restore();
  }

  // Top gloss highlight
  const gloss = ctx.createLinearGradient(x, y, x, y + 60);
  gloss.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
  gloss.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.save();
  roundedPath(ctx, x + 2, y + 2, w - 4, h - 4, r - 2);
  ctx.clip();
  ctx.fillStyle = gloss;
  ctx.fillRect(x + 2, y + 2, w - 4, 60);
  ctx.restore();

  // Top colored glowing pin-stripe
  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 10;
  line(ctx, x + 24, y + 2, x + Math.min(w - 24, 180), y + 2, accent, 2.5);
  ctx.restore();
}

function cardBadgeHeader(ctx: SKRSContext2D, x: number, y: number, title: string, iconType: 'rank' | 'share' | 'perf' | 'user'): void {
  // Hexagonal icon container
  const hx = x + 16, hy = y;
  const hr = 18;
  const pts: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (-90 + i * 60) * Math.PI / 180;
    pts.push([hx + Math.cos(a) * hr, hy + Math.sin(a) * hr]);
  }
  polygon(ctx, pts, 'rgba(76, 29, 149, 0.75)', 'rgba(216, 180, 254, 0.65)', 1.2);

  if (iconType === 'rank') drawVectorCrown(ctx, hx, hy, 20, '#FFF', '#D946EF', 1.5);
  else if (iconType === 'share') drawVectorStar(ctx, hx, hy, 8, '#FFF', '#38BDF8', 1.5);
  else if (iconType === 'perf') drawVectorBars(ctx, hx - 9, hy - 9, 18, 18, '#F472B6');
  else drawVectorStar(ctx, hx, hy, 9, '#FFF', '#C084FC', 1.5);

  txt(ctx, title, x + 44, y + 7, 20, '#FFFFFF', true);
}

// ============================================================================
// STAGE & AVATAR RENDERING
// ============================================================================

interface CacheItem<T> { value: T; expires: number }
const imageCache = new Map<string, CacheItem<Image>>();
const pendingImages = new Map<string, Promise<Image | null>>();
const avatarUrlCache = new Map<number, CacheItem<string | null>>();
const pendingAvatars = new Map<number, Promise<string | null>>();

function cachePut<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value!);
}

async function fetchImage(url: string): Promise<Image | null> {
  try {
    const u = new URL(url);
    if (!['https:', 'http:'].includes(u.protocol)) return null;
    const res = await fetch(u, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok || !res.body) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.startsWith('image/')) return null;

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let len = 0;
    const limit = 8 * 1024 * 1024;
    try {
      while (true) {
        const n = await reader.read();
        if (n.done) break;
        len += n.value.byteLength;
        if (len > limit) { await reader.cancel(); return null; }
        chunks.push(n.value);
      }
    } finally { reader.releaseLock(); }
    const img = await loadImage(Buffer.concat(chunks));
    return img.width > 0 && img.height > 0 ? img : null;
  } catch { return null; }
}

async function loadRemote(url: string | null | undefined): Promise<Image | null> {
  if (!url) return null;
  const hit = imageCache.get(url);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (pendingImages.has(url)) return pendingImages.get(url)!;

  const p = fetchImage(url).then(img => {
    if (img) cachePut(imageCache, url, { value: img, expires: Date.now() + 300_000 }, 40);
    return img;
  }).finally(() => pendingImages.delete(url));
  pendingImages.set(url, p);
  return p;
}

function validId(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function idFromAvatarUrl(url: string | null): number | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return validId(u.searchParams.get('userId') ?? u.searchParams.get('userIds'));
  } catch { return null; }
}

async function fullBodyUrl(userId: number): Promise<string | null> {
  const hit = avatarUrlCache.get(userId);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (pendingAvatars.has(userId)) return pendingAvatars.get(userId)!;

  const p = (async () => {
    try {
      const res = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png&isCircular=false`, {
        signal: AbortSignal.timeout(12_000),
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const body = await res.json() as { data?: { targetId?: number; state?: string; imageUrl?: string }[] };
      const row = body.data?.find(e => e.targetId === userId && e.state === 'Completed');
      return row?.imageUrl ?? null;
    } catch { return null; }
  })().then(v => {
    cachePut(avatarUrlCache, userId, { value: v, expires: Date.now() + (v ? 300_000 : 20_000) }, 256);
    return v;
  }).finally(() => pendingAvatars.delete(userId));
  pendingAvatars.set(userId, p);
  return p;
}

async function playerImage(userId: number | null, avatarUrl: string | null, override?: string | null): Promise<Image | null> {
  if (override) {
    const i = await loadRemote(override);
    if (i) return i;
  }
  if (userId) {
    const url = await fullBodyUrl(userId);
    if (url) {
      const i = await loadRemote(url);
      if (i) return i;
    }
  }
  return loadRemote(avatarUrl);
}

function drawCircleAvatar(ctx: SKRSContext2D, img: Image | null, cx: number, cy: number, r: number): void {
  // Ambient glow
  ctx.save();
  ctx.shadowColor = '#D946EF';
  ctx.shadowBlur = 24;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(147, 51, 234, 0.4)';
  ctx.fill();
  ctx.restore();

  // Circular border ring
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
  ctx.strokeStyle = '#F0ABFC';
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // Image fill or fallback
  ctx.beginPath();
  ctx.arc(cx, cy, r - 3, 0, Math.PI * 2);
  ctx.clip();
  if (img) {
    const f = Math.max((r * 2) / img.width, (r * 2) / img.height);
    const dw = img.width * f, dh = img.height * f;
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
  } else {
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, '#3B1556');
    g.addColorStop(1, '#15051E');
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    drawVectorStar(ctx, cx, cy, r * 0.45, '#F5D0FE', '#A855F7', 2);
  }
  ctx.restore();
}

// ============================================================================
// MAJOR UI SECTIONS
// ============================================================================

function drawHeaderBar(
  ctx: SKRSContext2D,
  w: number,
  meta: { tag: string; event: string },
  mode: TimeframeMode,
  assets?: ClanAssets,
): void {
  // Brand Logo on the left
  drawContain(ctx, assets?.logo ?? null, 40, 22, 94, 94, 0.98);

  // Title stack
  txt(ctx, 'PLAYER HISTORY', 150, 64, 40, '#FFFFFF', true);
  caps(ctx, 'R3V0 CLAN ANALYTICS', 152, 92, 11, C.textMuted, 'left', 2.4);

  // Decorative center fantasy ornament
  if (assets?.headerOrnament) {
    drawContain(ctx, assets.headerOrnament, 600, 26, 380, 76, 0.18);
  }

  // Right badges & event info
  const modeBadge = `${mode.toUpperCase()} WINDOW`;
  rr(ctx, w - 300, 34, 122, 34, 17, 'rgba(88, 28, 135, 0.65)', 'rgba(216, 180, 254, 0.45)', 1);
  caps(ctx, modeBadge, w - 239, 56, 10, '#F5D0FE', 'center', 1.2);

  rr(ctx, w - 165, 34, 125, 34, 17, 'rgba(4, 78, 72, 0.55)', 'rgba(45, 212, 191, 0.65)', 1);
  caps(ctx, 'LIVE DATA', w - 102, 56, 10, '#99F6E4', 'center', 1.4);

  caps(ctx, meta.event, w - 40, 92, 11, '#E9D5FF', 'right', 1.6);
  caps(ctx, meta.tag ? `CLAN [${meta.tag}]` : '[R3V0 SQUAD]', w - 40, 110, 9, C.textDim, 'right', 1.4);

  // Subtle separator line
  line(ctx, 40, 126, w - 40, 126, 'rgba(216, 180, 254, 0.22)', 1.2);
}

function drawHeroStage(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number,
  title: string, tag: string, rank: number | null, consistency: number | null,
  avatar: Image | null,
  current: number | null, gain: number | null, average: number | null,
  assets?: ClanAssets,
): void {
  glassCard(ctx, x, y, w, h, 26, '#D946EF', assets);

  // Partition widths
  const leftW = 320;
  const rightX = x + leftW;
  const rightW = w - leftW;

  // Vertical separator between player identity and fantasy diorama
  line(ctx, rightX, y + 28, rightX, y + h - 105, 'rgba(216, 180, 254, 0.16)', 1);

  // --- LEFT: PLAYER PROFILE ZONE ---
  caps(ctx, 'PLAYER PROFILE', x + 34, y + 42, 10, C.textMuted, 'left', 2.0);
  drawCircleAvatar(ctx, avatar, x + 110, y + 130, 64);

  const cleanName = title || 'Player';
  const nameSize = fitText(ctx, cleanName, leftW - 56, 32);
  txt(ctx, cleanName, x + 32, y + 230, nameSize, '#FFFFFF', true);
  caps(ctx, `@${cleanName.toLowerCase().replace(/\s+/g, '')}`, x + 34, y + 256, 10, '#D8B4FE', 'left', 1.3);

  // Badges: Tag & Rank
  rr(ctx, x + 32, y + 276, 118, 32, 16, 'rgba(76, 29, 149, 0.65)', 'rgba(216, 180, 254, 0.35)', 1);
  caps(ctx, tag ? `[${tag}]` : '[NO CLAN]', x + 91, y + 297, 9, '#F5D0FE', 'center', 1.2);

  rr(ctx, x + 160, y + 276, 118, 32, 16, 'rgba(76, 29, 149, 0.65)', 'rgba(216, 180, 254, 0.35)', 1);
  caps(ctx, rank ? `RANK #${rank}` : 'UNRANKED', x + 219, y + 297, 9, '#F5D0FE', 'center', 1.2);

  // Activity Bar
  caps(ctx, 'SESSION ACTIVITY', x + 34, y + 348, 9, C.textDim, 'left', 1.5);
  const actVal = Math.max(0, Math.min(1, consistency ?? 0));
  rr(ctx, x + 32, y + 360, leftW - 64, 10, 5, 'rgba(48, 16, 72, 0.7)');
  if (actVal > 0) {
    const actGrad = ctx.createLinearGradient(x + 32, 0, x + leftW - 32, 0);
    actGrad.addColorStop(0, '#A855F7');
    actGrad.addColorStop(1, '#F472F6');
    rr(ctx, x + 32, y + 360, (leftW - 64) * actVal, 10, 5, actGrad);
  }
  caps(ctx, consistency === null ? 'NO DATA' : `${Math.round(actVal * 100)}%`, x + leftW - 32, y + 348, 9, '#F0ABFC', 'right', 1.2);

  // --- RIGHT: FANTASY CLAN DIORAMA (The Stage) ---
  const stageY = y + 20;
  const stageH = h - 130;

  // Left & Right Pillars flanking the stage
  drawContainFlipped(ctx, assets?.pillar ?? null, rightX + 16, stageY + 20, 84, stageH - 40, false, 0.35);
  drawContainFlipped(ctx, assets?.pillar ?? null, rightX + rightW - 100, stageY + 20, 84, stageH - 40, true, 0.35);

  // Pedestal / Platform centered at bottom of stage
  const platW = 380, platH = 100;
  const platX = rightX + (rightW - platW) / 2;
  const platY = stageY + stageH - 85;
  drawContain(ctx, assets?.platform ?? null, platX, platY, platW, platH, 0.88);

  // Majestic Clan Emblem in background of stage
  const logoW = 240, logoH = 200;
  const logoX = rightX + (rightW - logoW) / 2;
  const logoY = stageY + 20;
  drawContain(ctx, assets?.logo ?? null, logoX, logoY, logoW, logoH, 0.95);

  // Mascots standing guard on the pedestal wings
  drawContain(ctx, assets?.angel ?? null, rightX + 65, stageY + 115, 95, 95, 0.85);
  drawContain(ctx, assets?.bat ?? null, rightX + rightW - 160, stageY + 115, 95, 95, 0.85);

  // Crystal clusters flanking the bottom of the pillars
  drawContain(ctx, assets?.crystals ?? null, rightX + 22, platY + 10, 80, 85, 0.65);
  drawContainFlipped(ctx, assets?.crystals ?? null, rightX + rightW - 102, platY + 10, 80, 85, true, 0.65);

  // --- BOTTOM METRICS UNIFICATION BAR ---
  const barY = y + h - 92;
  const cardW = (w - 68) / 3;

  const drawMetricTile = (bx: number, label: string, val: string, accent: string, isPositive?: boolean) => {
    rr(ctx, bx, barY, cardW, 74, 18, 'rgba(15, 6, 26, 0.92)', 'rgba(216, 180, 254, 0.22)', 1);
    rr(ctx, bx + 16, barY + 16, 4, 42, 2, accent);
    caps(ctx, label, bx + 32, barY + 30, 9, C.textDim, 'left', 1.8);
    txt(ctx, val, bx + 32, barY + 58, 26, isPositive ? '#5EEAD4' : '#FFFFFF', true);
  };

  drawMetricTile(x + 20, 'TOTAL STARS COLLECTED', current === null ? '—' : fmt(current), '#A855F7');
  drawMetricTile(x + 20 + cardW + 14, 'SESSION WINDOW GAIN', gain === null ? '—' : `${gain >= 0 ? '+' : ''}${fmt(gain)}`, '#F472B6', (gain ?? 0) > 0);
  drawMetricTile(x + 20 + (cardW + 14) * 2, 'AVERAGE PER HOUR', average === null ? '—' : fmt(average), '#38BDF8');
}

function drawRankCard(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, rank: number | null, members: number | null, lead: number | null, assets?: ClanAssets): void {
  glassCard(ctx, x, y, w, h, 20, '#C084FC', assets);
  cardBadgeHeader(ctx, x + 24, y + 32, 'CLAN POSITION', 'rank');

  // Big Rank text
  txt(ctx, rank ? `#${rank}` : '—', x + 30, y + 106, 68, '#FFFFFF', true);

  // Stacked metrics
  const rx = x + 190;
  caps(ctx, 'TOTAL ROSTER', rx, y + 76, 9, C.textDim, 'left', 1.5);
  txt(ctx, members ? `${members} Members` : '—', rx, y + 98, 19, '#FFFFFF', true);

  caps(ctx, 'LEAD TO NEXT', rx, y + 124, 9, C.textDim, 'left', 1.5);
  txt(ctx, lead !== null ? `+${fmt(lead)} pts` : '—', rx, y + 146, 19, '#F0ABFC', true);

  // Subtle Trophy badge on the right
  drawVectorTrophy(ctx, x + w - 54, y + 75, 48, 'rgba(243, 232, 255, 0.95)', '#A855F7');
}

function drawContributionCard(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, share: number | null, clanTotal: number | null, assets?: ClanAssets): void {
  glassCard(ctx, x, y, w, h, 20, '#D946EF', assets);
  cardBadgeHeader(ctx, x + 24, y + 32, 'CLAN CONTRIBUTION', 'share');

  // Donut Gauge
  const cx = x + 82, cy = y + 96, cr = 38;
  drawVectorPieChart(ctx, cx, cy, cr, share ?? 0);
  txt(ctx, share === null ? '—' : `${Math.round(share)}%`, cx, cy + 8, 22, '#FFFFFF', true, 'center');

  // Stacked clan totals
  const tx = x + 160;
  caps(ctx, 'TOTAL CLAN SCORE', tx, y + 78, 9, C.textDim, 'left', 1.6);
  txt(ctx, clanTotal === null ? '—' : fmt(clanTotal), tx, y + 112, 34, '#FFFFFF', true);
  caps(ctx, clanTotal === null ? '0 EXACT' : `${fmtExact(clanTotal)} STARS`, tx, y + 134, 8, '#D8B4FE', 'left', 1.2);

  // Coins icon overlay
  if (assets?.coins) {
    drawContain(ctx, assets.coins, x + w - 105, y + 68, 86, 70, 0.45);
  }
}

function drawPerformanceCard(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number,
  gain: number | null, average: number | null, best: number | null, pace: number | null,
  assets?: ClanAssets,
): void {
  glassCard(ctx, x, y, w, h, 20, '#38BDF8', assets);
  cardBadgeHeader(ctx, x + 24, y + 32, 'VELOCITY & PERFORMANCE', 'perf');

  const items = [
    { label: 'SESSION GAIN', val: gain === null ? '—' : `${gain >= 0 ? '+' : ''}${fmt(gain)}`, color: '#5EEAD4' },
    { label: 'AVG / HOUR', val: average === null ? '—' : fmt(average), color: '#FFFFFF' },
    { label: 'BEST SPIKE', val: best === null ? '—' : fmt(best), color: '#F472B6' },
    { label: 'CURRENT PACE', val: pace === null ? '—' : `${fmt(pace)}/h`, color: '#67E8F9' },
  ] as const;

  const colW = (w - 60) / 2;
  items.forEach((it, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const ix = x + 30 + col * colW;
    const iy = y + 74 + row * 46;

    caps(ctx, it.label, ix, iy, 8, C.textDim, 'left', 1.5);
    txt(ctx, it.val, ix, iy + 22, 19, it.color, true);
  });
}

// ============================================================================
// TIMELINE CHART PANEL
// ============================================================================

interface Series { values: (number | null)[]; start: number; end: number; step: number }

function historySeries(points: HistoryPoint[] | null | undefined, totalMs: number, count: number, now: number): Series {
  const arr = (Array.isArray(points) ? points : []).filter(p => p && Number.isFinite(p.ts) && Number.isFinite(p.value) && p.ts <= now).sort((a, b) => a.ts - b.ts);
  const start = now - totalMs, step = totalMs / count;
  const values: (number | null)[] = Array.from({ length: count }, () => null);

  for (let i = 0; i < count; i++) {
    const lo = start + i * step, hi = lo + step;
    let a: HistoryPoint | undefined, b: HistoryPoint | undefined;
    for (const p of arr) {
      if (p.ts <= lo) a = p;
      if (p.ts <= hi) b = p;
      else break;
    }
    if (!a) a = arr.find(p => p.ts >= lo && p.ts <= hi);
    if (!a || !b || b.ts <= a.ts || b.value < a.value) continue;
    values[i] = b.value - a.value;
  }
  return { values, start, end: now, step };
}

function chartPanel(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number,
  series: Series,
  mode: TimeframeMode,
  assets?: ClanAssets,
): void {
  glassCard(ctx, x, y, w, h, 24, '#A855F7', assets);

  // Header
  txt(ctx, 'CONTRIBUTION TIMELINE', x + 32, y + 40, 24, '#FFFFFF', true);
  const mins = series.step / 60_000;
  const interval = mins >= 60 ? `${Number((mins / 60).toFixed(1))}H` : `${Math.round(mins)}M`;
  caps(ctx, `${mode.toUpperCase()} SCOPE  •  ${interval} BUCKETS`, x + w - 32, y + 38, 10, C.textMuted, 'right', 1.8);

  const px = x + 75;
  const py = y + 68;
  const pw = w - 110;
  const ph = h - 110;
  const bottom = py + ph;

  const vals = series.values.filter((v): v is number => v !== null);
  const max = Math.max(...vals, 0);
  const yMax = max > 0 ? max * 1.15 : 1;

  // Horizontal Grid Lines
  for (let i = 0; i <= 4; i++) {
    const gy = py + (ph * i) / 4;
    line(ctx, px, gy, px + pw, gy, 'rgba(216, 180, 254, 0.12)', 1);
    txt(ctx, max > 0 ? fmt(yMax * (1 - i / 4)) : (i === 4 ? '0' : ''), px - 12, gy + 4, 11, C.textDim, false, 'right');
  }

  // Draw Bars
  const count = Math.max(1, series.values.length);
  const slotW = pw / count;
  const barW = Math.max(8, Math.min(26, slotW * 0.52));

  series.values.forEach((raw, i) => {
    const value = raw ?? 0;
    const bh = max > 0 ? Math.max(value > 0 ? 6 : 2, (value / yMax) * (ph - 4)) : 2;
    const bx = px + slotW * i + (slotW - barW) / 2;
    const by = bottom - bh;

    const g = ctx.createLinearGradient(0, by, 0, bottom);
    g.addColorStop(0, '#F5D0FE');
    g.addColorStop(0.3, '#E879F9');
    g.addColorStop(0.7, '#A855F7');
    g.addColorStop(1, '#4C1D95');

    ctx.save();
    if (value > 0) {
      ctx.shadowColor = '#D946EF';
      ctx.shadowBlur = 10;
    }
    rr(ctx, bx, by, barW, bh, Math.min(6, barW / 2), g, value > 0 ? 'rgba(255, 255, 255, 0.45)' : 'rgba(216, 180, 254, 0.15)', 1);
    ctx.restore();
  });

  // Best Peak Flag
  if (max > 0) {
    const peakIdx = series.values.indexOf(max);
    const pbx = px + slotW * peakIdx + slotW / 2;
    const pby = bottom - (max / yMax) * (ph - 4);
    const pillW = 100, pillH = 26;
    const pillX = Math.max(px, Math.min(px + pw - pillW, pbx - pillW / 2));
    const pillY = Math.max(py + 4, pby - 34);

    rr(ctx, pillX, pillY, pillW, pillH, 8, 'rgba(88, 28, 135, 0.95)', '#F0ABFC', 1.2);
    caps(ctx, `PEAK: +${fmt(max)}`, pillX + pillW / 2, pillY + 16, 8, '#FFFFFF', 'center', 1.0);
  }

  // X-Axis Time Ticks
  const hours = (series.end - series.start) / 3_600_000;
  const ticks = hours <= 6 ? 6 : 8;
  for (let i = 0; i <= ticks; i++) {
    const ago = hours * (1 - i / ticks);
    const label = i === ticks ? 'NOW' : ago >= 1 ? `-${Number(ago.toFixed(1))}h` : `-${Math.round(ago * 60)}m`;
    txt(ctx, label, px + (pw * i) / ticks, bottom + 24, 11, i === ticks ? '#F0ABFC' : C.textDim, false, 'center');
  }

  // Side accent crystals on bottom chart corners
  if (assets?.crystals) {
    drawContain(ctx, assets.crystals, x + 10, y + h - 70, 60, 60, 0.18);
    drawContainFlipped(ctx, assets.crystals, x + w - 70, y + h - 70, 60, 60, true, 0.18);
  }
}

// ============================================================================
// MAIN RENDER ENTRY POINTS
// ============================================================================

function eventMeta(subtitle: string, heading?: readonly [string, string]): { tag: string; event: string } {
  const parts = (subtitle ?? '').split(/[•|]/).map(s => s.trim()).filter(Boolean);
  const tag = (parts[0] ?? '').replace(/[\[\]]/g, '').slice(0, 24);
  const event = heading?.join(' ') ?? (parts.slice(1).join(' · ') || 'SPACE MINE CLAN BATTLE');
  return { tag, event };
}

function num(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
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
  const canvas = createCanvas(w * scale, h * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const themeDir = assetDir(options.assetDirectory);
  registerFonts(themeDir);

  const [avatar, assets] = await Promise.all([
    playerImage(validId(userId) ?? idFromAvatarUrl(avatarUrl), avatarUrl, options.avatarRenderUrl),
    loadClanAssets(themeDir),
  ]);

  // Deep Fantasy Background
  ctx.fillStyle = C.bgVoid;
  ctx.fillRect(0, 0, w, h);
  drawCover(ctx, assets.background, 0, 0, w, h, 0.45);

  const vignette = ctx.createRadialGradient(w / 2, h / 2, 200, w / 2, h / 2, Math.max(w, h) * 0.75);
  vignette.addColorStop(0, 'rgba(10, 3, 20, 0.1)');
  vignette.addColorStop(1, 'rgba(4, 1, 8, 0.88)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  // Data series calculations
  const tf = getTimeframeConfig(selectedTimeframe);
  const now = options.now ?? Date.now();
  const series = historySeries(stats?.points, tf.totalMs, tf.buckets, now);
  const values = series.values.filter((v): v is number => v !== null);

  const current = num(stats?.current);
  const gain = values.length ? values.reduce((a, b) => a + b, 0) : null;
  const average = gain === null ? null : gain / (tf.totalMs / 3_600_000);
  const best = values.length ? Math.max(...values) : null;
  const last = series.values.at(-1) ?? null;
  const pace = last === null ? null : last / (series.step / 3_600_000);
  const consistency = values.length ? values.filter(v => v > 0).length / values.length : null;

  const rank = validId(rivalry?.rank);
  const members = validId(rivalry?.totalMembers);
  const clanTotal = num(rivalry?.clanPoints);
  const userPoints = num(rivalry?.userPoints) ?? current;
  const share = clanTotal && clanTotal > 0 && userPoints !== null ? Math.min(100, Math.max(0, (userPoints / clanTotal) * 100)) : null;
  const lead = rivalry?.behind && num(rivalry.behind.lead) !== null ? num(rivalry.behind.lead) : null;
  const meta = eventMeta(subtitle, options.heading);

  // Render Core UI Sections
  drawHeaderBar(ctx, w, meta, selectedTimeframe, assets);

  // Middle Row: Left Hero (990px) + Right Stack (510px) = 1520px span
  drawHeroStage(ctx, 40, 145, 990, 515, title, meta.tag, rank, consistency, avatar, current, gain, average, assets);

  const rightX = 1050, rightW = 510;
  drawRankCard(ctx, rightX, 145, rightW, 155, rank, members, lead, assets);
  drawContributionCard(ctx, rightX, 320, rightW, 155, share, clanTotal, assets);
  drawPerformanceCard(ctx, rightX, 495, rightW, 165, gain, average, best, pace, assets);

  // Bottom Timeline Chart
  chartPanel(ctx, 40, 680, 1520, 275, series, selectedTimeframe, assets);

  // Clean Footer
  caps(ctx, meta.tag ? `${meta.tag} CLAN HQ  •  OPERATIONAL TELEMETRY` : 'R3V0 NETWORK  •  CLAN INTELLIGENCE', 45, 984, 9, C.textDim, 'left', 1.8);
  caps(ctx, 'PET SIMULATOR 99  •  VERIFIED LIVE METRICS', w - 45, 984, 9, C.textDim, 'right', 1.8);

  return canvas.encode('png');
}

export async function renderPlayerCard(
  title: string,
  subtitle: string,
  avatarUrl: string | null,
  userId?: number | null,
  options: PlayerCardRenderOptions = {},
): Promise<Buffer> {
  const w = 640, h = 840, scale = options.scale === 1 ? 1 : 2;
  const canvas = createCanvas(w * scale, h * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const themeDir = assetDir(options.assetDirectory);
  registerFonts(themeDir);

  const [avatar, assets] = await Promise.all([
    playerImage(validId(userId) ?? idFromAvatarUrl(avatarUrl), avatarUrl, options.avatarRenderUrl),
    loadClanAssets(themeDir),
  ]);

  const meta = eventMeta(subtitle, options.heading);

  // Background
  ctx.fillStyle = C.bgVoid;
  ctx.fillRect(0, 0, w, h);
  drawCover(ctx, assets.background, 0, 0, w, h, 0.4);

  // Header Logo
  drawContain(ctx, assets.logo, (w - 180) / 2, 24, 180, 95, 0.95);

  // Main Identity Card
  glassCard(ctx, 40, 135, 560, 650, 26, '#D946EF', assets);

  // Pedestal & Mascot Stage inside card
  const platW = 320, platH = 80;
  const platX = (w - platW) / 2;
  const platY = 320;
  drawContain(ctx, assets.platform, platX, platY, platW, platH, 0.85);

  drawCircleAvatar(ctx, avatar, w / 2, 240, 78);
  drawContain(ctx, assets.angel, 75, 205, 80, 80, 0.85);
  drawContain(ctx, assets.bat, w - 155, 205, 80, 80, 0.85);

  // Crystals at bottom corners of stage
  drawContain(ctx, assets.crystals, 55, 340, 75, 80, 0.55);
  drawContainFlipped(ctx, assets.crystals, w - 130, 340, 75, 80, true, 0.55);

  // Name & Rank Stack
  const pName = title || 'Player';
  txt(ctx, pName, w / 2, 450, fitText(ctx, pName, 480, 36), '#FFFFFF', true, 'center');
  caps(ctx, meta.tag ? `CLAN [${meta.tag}]` : '[SOLO ROSTER]', w / 2, 480, 10, '#D8B4FE', 'center', 1.6);

  rr(ctx, w / 2 - 80, 508, 160, 36, 18, 'rgba(88, 28, 135, 0.8)', 'rgba(216, 180, 254, 0.45)', 1.2);
  caps(ctx, options.rank ? `CLAN RANK #${options.rank}` : 'MEMBER', w / 2, 531, 9, '#F5D0FE', 'center', 1.4);

  if (options.roleLabel) {
    rr(ctx, 70, 575, 500, 52, 16, 'rgba(15, 6, 26, 0.85)', 'rgba(216, 180, 254, 0.22)', 1);
    caps(ctx, 'ASSIGNED ROLE', w / 2, 595, 8, C.textDim, 'center', 1.8);
    txt(ctx, options.roleLabel, w / 2, 617, 18, '#5EEAD4', true, 'center');
  }

  // Footer Tagline
  caps(ctx, 'R3V0 VERIFIED IDENTITY', w / 2, 814, 9, C.textDim, 'center', 2.0);

  return canvas.encode('png');
}

export async function renderRap(r: RapResult): Promise<Buffer> {
  const w = 1200, h = 680, scale = 2;
  const canvas = createCanvas(w * scale, h * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const themeDir = assetDir();
  registerFonts(themeDir);
  const assets = await loadClanAssets(themeDir);

  // Background
  ctx.fillStyle = C.bgVoid;
  ctx.fillRect(0, 0, w, h);
  drawCover(ctx, assets.background, 0, 0, w, h, 0.4);

  // Header
  drawContain(ctx, assets.logo, 40, 20, 110, 85, 0.95);
  txt(ctx, 'RAP TRACKER', 165, 62, 38, '#FFFFFF', true);
  caps(ctx, 'PET MARKET INTELLIGENCE & VALUATION', 167, 88, 10, C.textMuted, 'left', 2.2);

  // Left Showcase: 340px
  glassCard(ctx, 40, 125, 350, 515, 24, '#D946EF', assets);

  const img = await loadRemote(r.imageUrl);
  if (img) {
    drawContain(ctx, img, 65, 170, 300, 260, 1);
  } else {
    drawContain(ctx, assets.crystalCat, 90, 170, 250, 250, 0.85);
  }

  txt(ctx, r.name, 215, 475, fitText(ctx, r.name, 300, 30), '#FFFFFF', true, 'center');
  caps(ctx, 'TARGET ITEM', 215, 502, 9, C.textDim, 'center', 1.8);

  if (assets.coins) {
    drawContain(ctx, assets.coins, 115, 530, 200, 80, 0.4);
  }

  // Right Table: 750px
  glassCard(ctx, 410, 125, 750, 515, 24, '#A855F7', assets);
  txt(ctx, 'MARKET VARIANTS', 445, 172, 24, '#FFFFFF', true);

  // Table Columns Header
  caps(ctx, 'VARIANT TYPE', 450, 208, 9, C.textDim, 'left', 1.8);
  caps(ctx, 'DIAMONDS (RAP)', 870, 208, 9, C.textDim, 'right', 1.8);
  caps(ctx, '24H DELTA', 1115, 208, 9, C.textDim, 'right', 1.8);

  const vars = Array.isArray(r.variants) ? r.variants.slice(0, 5) : [];
  vars.forEach((v, i) => {
    const yy = 224 + i * 72;
    rr(ctx, 440, yy, 690, 58, 16, 'rgba(15, 6, 26, 0.88)', 'rgba(216, 180, 254, 0.18)', 1);

    txt(ctx, v.label, 460, yy + 36, 21, '#FFFFFF', true);
    txt(ctx, num(v.value) === null ? '—' : fmt(v.value), 870, yy + 36, 23, '#FFF', true, 'right');

    const d = typeof v.delta === 'number' && Number.isFinite(v.delta) ? v.delta : null;
    const p = typeof v.deltaPct === 'number' && Number.isFinite(v.deltaPct) ? v.deltaPct : null;
    const isUp = (d ?? 0) >= 0;
    const str = d === null ? '—' : `${isUp ? '+' : ''}${fmt(d)}${p === null ? '' : ` (${isUp ? '+' : ''}${p.toFixed(1)}%)`}`;
    txt(ctx, str, 1110, yy + 36, 18, d === null ? C.textDim : isUp ? '#5EEAD4' : '#F472B6', true, 'right');
  });

  caps(ctx, `BASELINE: ${r.baselineLabel ?? 'NORMAL'}`, 445, 608, 9, C.textDim, 'left', 1.8);

  return canvas.encode('png');
}

// ============================================================================
// BACKWARD COMPATIBILITY EXPORTS
// ============================================================================

export const drawVectorDonut = drawVectorPieChart;

export function drawGamePanel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, radius = 20, fillColor = '#251036', bevelColor = '#0C0413', bevelHeight = 6, strokeColor?: string | null): void {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.48)';
  ctx.shadowBlur = 15;
  ctx.shadowOffsetY = bevelHeight;
  rr(ctx, x, y + bevelHeight, w, h, radius, bevelColor);
  ctx.restore();
  rr(ctx, x, y, w, h, radius, fillColor, strokeColor ?? '#A855F7', 2);
}

export function drawRibbonBanner(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, title: string, sub: string, angle = 0): void {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(angle);
  ctx.translate(-w / 2, -h / 2);
  drawGamePanel(ctx, 0, 0, w, h, 16, '#35104C', '#11061A', 6, '#D946EF');
  drawVectorCrown(ctx, w / 2, 18, 28);
  txt(ctx, title, w / 2, 48, 25, '#FFFFFF', true, 'center');
  caps(ctx, sub, w / 2, 67, 9, '#E9D5FF', 'center', 1.4);
  ctx.restore();
}

export function drawWoodenPlank(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, text: string, angle = 0): void {
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(angle);
  ctx.translate(-w / 2, -h / 2);
  drawGamePanel(ctx, 0, 0, w, h, 12, '#32104A', '#09020F', 6, '#D946EF');
  txt(ctx, text, w / 2, h / 2 + 7, fitText(ctx, text, w - 20, 16), '#FFF8FF', true, 'center');
  ctx.restore();
}

export function drawHangingBanner(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, title: string, lines: string[], angle = 0): void {
  ctx.save();
  ctx.translate(x + w / 2, y);
  ctx.rotate(angle);
  ctx.translate(-w / 2, 0);
  polygon(ctx, [[0, 0], [w, 0], [w, h - 16], [w / 2, h + 12], [0, h - 16]], '#32104A', '#D946EF', 2);
  txt(ctx, title, w / 2, 26, 15, '#FFFFFF', true, 'center');
  lines.slice(0, 4).forEach((s, i) => txt(ctx, s, w / 2, 50 + i * 16, 11, '#E9D5FF', false, 'center'));
  ctx.restore();
}

export function drawChunkyGamePanel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r = 18, bgGradTop = '#381151', bgGradBot = '#1A0827', bevelColor = '#09020F', bevelDepth = 6): void {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.5)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = bevelDepth;
  rr(ctx, x, y + bevelDepth, w, h, r, bevelColor);
  ctx.restore();
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, bgGradTop);
  g.addColorStop(1, bgGradBot);
  rr(ctx, x, y, w, h, r, g, '#A855F7', 2);
}

export function drawCreamTile(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r = 16): void {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, '#FFF8FF');
  g.addColorStop(1, '#E9D5FF');
  rr(ctx, x, y, w, h, r, g, '#A855F7', 2);
}
