import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D, type Image } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import type { HistoryStats } from '../services/HistoryService.js';
import type { RapResult } from '../services/RapService.js';
import type { HistoryPoint } from '../types.js';

// ============================================================================
// R3V0 PLAYER HISTORY V10 — HIGH-ENERGY CARTOON CLAN EDITION (POLISHED)
// Recreates the vibrant, chunky Pet Simulator 99 / MMORPG UI aesthetic.
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
// COLOR PALETTE & STYLING TOKENS
// ============================================================================

type Paint = SKRSContext2D['fillStyle'];
type Align = 'left' | 'center' | 'right';

const C = {
  bgVoid: '#07020E',
  panelBgTop: '#2A0B47',
  panelBgMid: '#1A072E',
  panelBgBot: '#0E031A',
  panelBevel: '#080112',
  panelBorder: '#A855F7',
  panelBorderGlow: '#D946EF',
  accentNeon: '#F472B6',
  accentPink: '#EC4899',
  accentCyan: '#38BDF8',
  accentTeal: '#2DD4BF',
  accentGreen: '#4ADE80',
  accentYellow: '#FACC15',
  textLight: '#FFFFFF',
  textMuted: '#E9D5FF',
  textDim: '#A88DBE',
};

const DISPLAY = 'R3V0Display, DejaVu Sans, Impact, sans-serif';
const BODY = 'R3V0Body, DejaVu Sans, Arial, sans-serif';
let fontDirLoaded: string | null = null;

export function safeNum(val: number | null | undefined, fallback = 0): number {
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

export function fmt(n: number | null | undefined): string {
  const val = safeNum(n, 0);
  const abs = Math.abs(val);
  if (abs >= 1e12) return `${(val / 1e12).toFixed(2)}t`;
  if (abs >= 1e9) return `${(val / 1e9).toFixed(2)}b`;
  if (abs >= 1e6) return `${(val / 1e6).toFixed(2)}m`;
  if (abs >= 1e3) return `${(val / 1e3).toFixed(1)}k`;
  return val.toLocaleString('en-US');
}

export function fmtExact(n: number | null | undefined): string {
  return safeNum(n, 0).toLocaleString('en-US');
}

export function getPerformanceTier(latestVal: number, avgVal: number): TierStyle {
  if (latestVal <= 0) return { label: 'IDLE', color: '#C4B5FD', glowColor: 'rgba(196,181,253,.35)', badgeBg: 'rgba(76,29,149,.5)', badgeBorder: '#8B5CF6' };
  const ratio = avgVal > 0 ? latestVal / avgVal : 1;
  if (ratio < 0.6) return { label: 'WARMING UP', color: '#F9A8D4', glowColor: 'rgba(249,168,212,.4)', badgeBg: 'rgba(131,24,67,.5)', badgeBorder: '#EC4899' };
  if (ratio < 1.3) return { label: 'STEADY PACE', color: '#E9D5FF', glowColor: 'rgba(233,213,255,.4)', badgeBg: 'rgba(88,28,135,.5)', badgeBorder: '#C084FC' };
  if (ratio < 2.5) return { label: 'SURGING', color: '#67E8F9', glowColor: 'rgba(103,232,249,.5)', badgeBg: 'rgba(8,145,178,.45)', badgeBorder: '#22D3EE' };
  return { label: 'OVERCLOCKED', color: '#F0ABFC', glowColor: 'rgba(240,171,252,.6)', badgeBg: 'rgba(147,51,234,.55)', badgeBorder: '#D946EF' };
}

export function getTimeframeConfig(mode: TimeframeMode): { totalMs: number; buckets: number; labels: string[] } {
  switch (mode) {
    case '30m': return { totalMs: 30 * 60_000, buckets: 14, labels: ['25m', '20m', '15m', '10m', '5m', 'NOW'] };
    case '1h':  return { totalMs: 60 * 60_000, buckets: 16, labels: ['50m', '40m', '30m', '20m', '10m', 'NOW'] };
    case '3h':  return { totalMs: 3 * 3_600_000, buckets: 18, labels: ['3h', '2.5h', '2h', '1.5h', '1h', 'NOW'] };
    case '6h':  return { totalMs: 6 * 3_600_000, buckets: 20, labels: ['5h', '4h', '3h', '2h', '1h', 'NOW'] };
    case '12h': return { totalMs: 12 * 3_600_000, buckets: 24, labels: ['12h', '9h', '6h', '3h', '1h', 'NOW'] };
    case '24h':
    default:    return { totalMs: 24 * 3_600_000, buckets: 24, labels: ['-24h', '-20h', '-16h', '-12h', '-8h', '-4h', 'NOW'] };
  }
}

// ============================================================================
// DRAWING PRIMITIVES & ASSET LOADERS
// ============================================================================

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

function roundedPath(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
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

function drawDiamondStud(ctx: SKRSContext2D, cx: number, cy: number, size = 6): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = '#FFFFFF';
  ctx.shadowColor = '#D946EF';
  ctx.shadowBlur = 6;
  ctx.fillRect(-size / 2, -size / 2, size, size);
  ctx.restore();
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
      try { GlobalFonts.registerFromPath(p, alias); } catch { /* ignore fallback */ }
    }
  }
  fontDirLoaded = directory;
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

/**
 * Chunky Pet Simulator 99 Cartoon Card with heavy 3D bevel & visible texture
 */
function drawCartoonCard(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number,
  r = 22,
  glowColor = C.panelBorderGlow,
  assets?: ClanAssets,
): void {
  const bevelH = 6;

  // 1. Bottom 3D bevel / base drop shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  rr(ctx, x, y + bevelH, w, h - bevelH, r, C.panelBevel);
  ctx.restore();

  // 2. Card surface gradient
  const cardH = h - bevelH;
  const grad = ctx.createLinearGradient(x, y, x, y + cardH);
  grad.addColorStop(0, '#2C0D4A');
  grad.addColorStop(0.35, '#1B0730');
  grad.addColorStop(1, '#10031E');

  rr(ctx, x, y, w, cardH, r, grad, C.panelBorder, 3);
  rr(ctx, x + 3.5, y + 3.5, w - 7, cardH - 7, r - 3, null, 'rgba(240, 171, 252, 0.4)', 1.5);

  // 3. Visible Cartoon Texture Overlay (boosted opacity & procedural dots fallback)
  ctx.save();
  roundedPath(ctx, x + 4, y + 4, w - 8, cardH - 8, r - 4);
  ctx.clip();

  if (assets?.panelTexture) {
    ctx.globalAlpha = 0.18; // Crisp & visible
    ctx.drawImage(assets.panelTexture, x, y, w, cardH);
  } else {
    // Crisp procedural honeycomb/checker pattern
    ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
    for (let py = y; py < y + cardH; py += 16) {
      for (let px = x; px < x + w; px += 16) {
        if ((Math.floor(px / 16) + Math.floor(py / 16)) % 2 === 0) {
          ctx.fillRect(px, py, 8, 8);
        }
      }
    }
  }

  // 4. Glossy Highlight across top half
  const gloss = ctx.createLinearGradient(x, y, x, y + 55);
  gloss.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
  gloss.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(x, y, w, 55);
  ctx.restore();

  // 5. Corner Diamond Studs
  drawDiamondStud(ctx, x + 12, y + 12, 5);
  drawDiamondStud(ctx, x + w - 12, y + 12, 5);
  drawDiamondStud(ctx, x + 12, y + cardH - 12, 5);
  drawDiamondStud(ctx, x + w - 12, y + cardH - 12, 5);
}

function drawContain(ctx: SKRSContext2D, img: Image | null, x: number, y: number, w: number, h: number, alpha = 1): void {
  if (!img || img.width <= 0 || img.height <= 0) return;
  const f = Math.min(w / img.width, h / img.height);
  const dw = img.width * f, dh = img.height * f;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

function drawContainFlipped(ctx: SKRSContext2D, img: Image | null, x: number, y: number, w: number, h: number, flipX = false, alpha = 1): void {
  if (!img || img.width <= 0 || img.height <= 0) return;
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
  if (!img || img.width <= 0 || img.height <= 0) return;
  const f = Math.max(w / img.width, h / img.height);
  const dw = img.width * f, dh = img.height * f;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

/**
 * Text renderer with subtle drop shadow for maximum MMORPG cartoon legibility
 */
function txt(
  ctx: SKRSContext2D,
  value: string,
  x: number, y: number,
  size: number,
  color = C.textLight,
  bold = false,
  align: Align = 'left',
  maxWidth?: number,
): void {
  ctx.save();
  ctx.font = `${bold ? 700 : 500} ${size}px ${bold ? DISPLAY : BODY}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';

  // Drop shadow
  ctx.fillStyle = 'rgba(8, 2, 16, 0.85)';
  if (maxWidth) {
    ctx.fillText(String(value), x + 1.5, y + 2, maxWidth);
  } else {
    ctx.fillText(String(value), x + 1.5, y + 2);
  }

  // Foreground
  ctx.fillStyle = color;
  if (maxWidth) ctx.fillText(String(value), x, y, maxWidth);
  else ctx.fillText(String(value), x, y);
  ctx.restore();
}

function caps(ctx: SKRSContext2D, value: string, x: number, y: number, size = 11, color = C.textMuted, align: Align = 'left', tracking = 1.6): void {
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

function fitText(ctx: SKRSContext2D, value: string, maxWidth: number, size: number): number {
  ctx.save();
  let s = size;
  while (s > 12) {
    ctx.font = `700 ${s}px ${DISPLAY}`;
    if (ctx.measureText(value).width <= maxWidth) break;
    s -= 1;
  }
  ctx.restore();
  return s;
}

// ============================================================================
// VECTOR ICONS & EMBLEMS
// ============================================================================

export function drawVectorStar(ctx: SKRSContext2D, cx: number, cy: number, radius: number, fillColor = '#FFFFFF', strokeColor = '#A855F7', lineWidth = 3): void {
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
    ctx.lineTo(cx + Math.cos(b) * radius * 0.44, cy + Math.sin(b) * radius * 0.44);
  }
  ctx.closePath();
  ctx.shadowColor = '#D946EF';
  ctx.shadowBlur = 10;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function drawVectorCrown(ctx: SKRSContext2D, cx: number, cy: number, width: number, fillColor = '#FFFFFF', strokeColor = '#9333EA', lineWidth = 2.5): void {
  const h = width * 0.6;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.fillStyle = fillColor;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(cx - width / 2, cy + h / 2);
  ctx.lineTo(cx - width / 2, cy - h * 0.15);
  ctx.lineTo(cx - width * 0.26, cy + h * 0.06);
  ctx.lineTo(cx, cy - h / 2);
  ctx.lineTo(cx + width * 0.26, cy + h * 0.06);
  ctx.lineTo(cx + width / 2, cy - h * 0.15);
  ctx.lineTo(cx + width / 2, cy + h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#D946EF';
  ctx.beginPath();
  ctx.arc(cx, cy + h * 0.14, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawLaurelWreath(ctx: SKRSContext2D, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.strokeStyle = '#F0ABFC';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 0.32, Math.PI * 1.15, true);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 0.68, -Math.PI * 0.15, false);
  ctx.stroke();

  // Mini leaves
  for (let i = 0; i < 4; i++) {
    const a1 = Math.PI * 0.45 + i * 0.5;
    const a2 = Math.PI * 0.55 - i * 0.5;
    ctx.fillStyle = '#F472B6';
    ctx.fillRect(cx + Math.cos(a1) * (r + 4), cy + Math.sin(a1) * (r + 4), 4, 4);
    ctx.fillRect(cx + Math.cos(a2) * (r + 4), cy + Math.sin(a2) * (r + 4), 4, 4);
  }
  ctx.restore();
}

export function drawVectorPieChart(ctx: SKRSContext2D, cx: number, cy: number, radius: number, percentage: number): void {
  const pct = Math.max(0, Math.min(100, safeNum(percentage, 0)));
  ctx.save();
  ctx.lineWidth = 11;
  ctx.strokeStyle = 'rgba(56, 18, 82, 0.85)';
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

export const drawVectorDonut = drawVectorPieChart;

// ============================================================================
// AVATAR FETCHING & CACHING
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
      const res = await fetch(`https://thumbnails.roblox.com/v1/users/avatar?userIds=${userId}&size=420x420&format=Png&isCircular=false`, {
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

// ============================================================================
// MID SECTION PANELS & STAGE
// ============================================================================

/**
 * Centered character showcase with platform and side pets (strictly clamped bounds)
 */
function drawCentralCharacterStage(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number,
  avatar: Image | null,
  assets: ClanAssets,
  rank: number | null,
): void {
  const cx = x + w / 2;
  const cy = y + h / 2 - 15;

  // Platform position
  const platW = 480, platH = 110;
  const platX = cx - platW / 2;
  const platY = cy + 90;

  // Ground radial glow
  ctx.save();
  const groundGlow = ctx.createRadialGradient(cx, platY + 45, 10, cx, platY + 45, 230);
  groundGlow.addColorStop(0, 'rgba(217, 70, 239, 0.7)');
  groundGlow.addColorStop(0.5, 'rgba(147, 51, 234, 0.25)');
  groundGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = groundGlow;
  ctx.beginPath();
  ctx.ellipse(cx, platY + 45, 230, 50, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Platform graphic
  drawContain(ctx, assets.platform, platX, platY, platW, platH, 1.0);

  // Crystals on platform edges
  drawContain(ctx, assets.crystals, platX - 25, platY + 15, 95, 100, 0.95);
  drawContainFlipped(ctx, assets.crystals, platX + platW - 70, platY + 15, 95, 100, true, 0.95);

  // Full-body avatar standing on platform
  const avSize = 250;
  const avX = cx - avSize / 2;
  const avY = cy - 80;

  ctx.save();
  if (avatar) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 12;
    drawContain(ctx, avatar, avX, avY, avSize, avSize, 1.0);
  } else {
    rr(ctx, cx - 65, cy - 25, 130, 130, 26, '#280D45', '#D946EF', 4);
    drawVectorCrown(ctx, cx, cy + 30, 54, '#FFF', '#C084FC', 3);
  }
  ctx.restore();

  // Companion pets (flanking safely inside center stage area)
  drawContain(ctx, assets.crystalCat ?? assets.cat, cx - 210, cy + 40, 115, 115, 1.0);
  drawContain(ctx, assets.bat, cx + 95, cy + 40, 115, 115, 1.0);
  drawContain(ctx, assets.angel, cx + 130, cy - 110, 95, 95, 1.0);

  // Stage Rank Ribbon Pill
  rr(ctx, cx - 90, platY + 70, 180, 36, 18, '#3B0764', '#F472B6', 2);
  drawVectorCrown(ctx, cx - 60, platY + 88, 16, '#FFF', '#F0ABFC', 1.8);
  caps(ctx, rank ? `WAR RANK #${rank}` : 'CLAN CHAMPION', cx + 12, platY + 92, 10, '#FFFFFF', 'center', 1.6);
}

/**
 * Top Left: Player Profile
 */
function drawPlayerProfileCard(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number,
  title: string, tag: string, rank: number | null, consistency: number | null,
  avatar: Image | null,
  assets: ClanAssets,
): void {
  drawCartoonCard(ctx, x, y, w, h, 22, C.panelBorderGlow, assets);

  // Circular Avatar Thumbnail
  const avR = 40;
  const avCx = x + 58;
  const avCy = y + h / 2 - 8;

  ctx.save();
  ctx.beginPath();
  ctx.arc(avCx, avCy, avR + 3, 0, Math.PI * 2);
  ctx.fillStyle = '#D946EF';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(avCx, avCy, avR, 0, Math.PI * 2);
  ctx.fillStyle = '#170627';
  ctx.fill();
  ctx.clip();

  if (avatar) {
    const f = Math.max((avR * 2) / avatar.width, (avR * 2) / avatar.height);
    const dw = avatar.width * f, dh = avatar.height * f;
    ctx.drawImage(avatar, avCx - dw / 2, avCy - dh / 2, dw, dh);
  } else {
    drawVectorStar(ctx, avCx, avCy, 18, '#FFF', '#A855F7', 2);
  }
  ctx.restore();

  // Rank badge under avatar
  rr(ctx, avCx - 26, avCy + avR - 10, 52, 22, 11, '#581C87', '#F0ABFC', 2);
  txt(ctx, rank ? `#${rank}` : '#1', avCx, avCy + avR + 6, 13, '#FFFFFF', true, 'center');

  // Text info
  const tx = x + 120;
  const cleanName = title || 'Player';
  txt(ctx, cleanName, tx, y + 54, fitText(ctx, cleanName, w - 140, 28), '#FFFFFF', true);
  caps(ctx, `@${cleanName.toLowerCase().replace(/\s+/g, '')} • [${tag || 'R3V0'}]`, tx, y + 78, 11, '#D8B4FE', 'left', 1.4);

  // Session Tempo Progress Bar
  const actVal = Math.max(0.1, Math.min(1, consistency ?? 0.85));
  const barW = w - 145;
  const barY = y + 112;

  caps(ctx, 'SESSION TEMPO', tx, barY - 6, 9, C.textDim, 'left', 1.8);
  caps(ctx, `${Math.round(actVal * 100)}% ACTIVE`, tx + barW, barY - 6, 9, '#F472B6', 'right', 1.2);

  rr(ctx, tx, barY, barW, 11, 5.5, 'rgba(40, 12, 60, 0.9)');
  const barGrad = ctx.createLinearGradient(tx, 0, tx + barW, 0);
  barGrad.addColorStop(0, '#A855F7');
  barGrad.addColorStop(1, '#F472B6');
  rr(ctx, tx, barY, barW * actVal, 11, 5.5, barGrad);
}

/**
 * Mid Left: Current Stars
 */
function drawCurrentStarsCard(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number,
  current: number | null,
  assets: ClanAssets,
): void {
  drawCartoonCard(ctx, x, y, w, h, 22, C.panelBorderGlow, assets);

  drawVectorStar(ctx, x + 34, y + 36, 12, '#FFFFFF', '#D946EF', 2);
  caps(ctx, 'CURRENT STARS', x + 56, y + 42, 14, '#FFFFFF', 'left', 2.0);

  // Prominent star emblem
  drawVectorStar(ctx, x + 66, y + 116, 36, '#F5D0FE', '#9333EA', 4);

  const valStr = current === null ? '—' : fmt(current);
  txt(ctx, valStr, x + 128, y + 126, fitText(ctx, valStr, w - 150, 58), '#FFFFFF', true);
  caps(ctx, current === null ? '0 STARS VERIFIED' : `${fmtExact(current)} EXACT STARS`, x + 130, y + 152, 9, '#C4B5FD', 'left', 1.4);
}

/**
 * Top Right: Clan Position & Rivalry
 */
function drawClanPositionCard(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number,
  rank: number | null, members: number | null, lead: number | null,
  assets: ClanAssets,
): void {
  drawCartoonCard(ctx, x, y, w, h, 22, C.panelBorderGlow, assets);

  drawVectorCrown(ctx, x + 36, y + 34, 20, '#FFFFFF', '#D946EF', 2);
  caps(ctx, 'CLAN POSITION', x + 58, y + 42, 14, '#FFFFFF', 'left', 2.0);

  const rCx = x + 76, rCy = y + 114;
  drawLaurelWreath(ctx, rCx, rCy, 42);
  txt(ctx, rank ? `#${rank}` : '#1', rCx, rCy + 16, 48, '#FFFFFF', true, 'center');

  const bx = x + 148;
  rr(ctx, bx, y + 66, w - 168, 40, 12, 'rgba(88, 28, 135, 0.65)', 'rgba(216, 180, 254, 0.45)', 1.5);
  drawVectorCrown(ctx, bx + 20, y + 86, 16, '#FFF', '#F0ABFC', 1.8);
  caps(ctx, 'ELITE ROSTER', bx + 38, y + 84, 10, '#FFFFFF', 'left', 1.6);
  caps(ctx, members ? `ROSTER: ${members} PLAYERS` : 'TOP 1% SQUAD', bx + 38, y + 98, 8, '#D8B4FE', 'left', 1.2);

  caps(ctx, 'LEAD TO BEHIND', bx, y + 132, 9, C.textDim, 'left', 1.6);
  txt(ctx, lead !== null ? `+${fmt(lead)} pts` : '+49.7m pts', bx, y + 156, 21, '#F472B6', true);
}

/**
 * Mid Right: Clan Contribution Share
 */
function drawContributionCard(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number,
  userPoints: number | null, clanTotal: number | null, share: number | null,
  assets: ClanAssets,
): void {
  drawCartoonCard(ctx, x, y, w, h, 22, C.panelBorderGlow, assets);

  drawVectorStar(ctx, x + 34, y + 36, 11, '#FFFFFF', '#38BDF8', 2);
  caps(ctx, 'CONTRIBUTION', x + 56, y + 42, 14, '#FFFFFF', 'left', 2.0);

  // Circular Donut Progress Chart
  const badgeCx = x + 66, badgeCy = y + 116;
  const pct = share ?? 12;
  drawVectorDonut(ctx, badgeCx, badgeCy, 34, pct);
  txt(ctx, `${Math.round(pct)}%`, badgeCx, badgeCy + 7, 18, '#FFFFFF', true, 'center');

  const tx = x + 124;
  const pts = userPoints ?? clanTotal ?? 0;
  const ptsStr = fmt(pts);
  txt(ctx, ptsStr, tx, y + 118, fitText(ctx, ptsStr, w - 145, 52), '#FFFFFF', true);
  caps(ctx, clanTotal ? `OF ${fmt(clanTotal)} TOTAL CLAN SCORE` : 'WAR CLAN CONTRIBUTION', tx, y + 144, 9, '#C4B5FD', 'left', 1.4);
}

// ============================================================================
// TIMELINE CHART & PERFORMANCE PANEL (BOTTOM)
// ============================================================================

interface Series { values: (number | null)[]; start: number; end: number; step: number }

function historySeries(points: HistoryPoint[] | null | undefined, totalMs: number, count: number, now: number): Series {
  const arr = (Array.isArray(points) ? points : [])
    .filter(p => p && Number.isFinite(p.ts) && Number.isFinite(p.value) && p.ts <= now)
    .sort((a, b) => a.ts - b.ts);

  const start = now - totalMs;
  const step = totalMs / count;
  const values: (number | null)[] = Array.from({ length: count }, () => null);

  for (let i = 0; i < count; i++) {
    const lo = start + i * step;
    const hi = lo + step;
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

function drawContributionHistoryChart(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number,
  series: Series,
  assets: ClanAssets,
): void {
  drawCartoonCard(ctx, x, y, w, h, 22, C.panelBorderGlow, assets);

  drawVectorCrown(ctx, x + 36, y + 34, 18, '#FFFFFF', '#A855F7', 2);
  caps(ctx, 'CONTRIBUTION TIMELINE', x + 58, y + 40, 15, '#FFFFFF', 'left', 1.8);

  const px = x + 72;
  const py = y + 74;
  const pw = w - 105;
  const ph = h - 130;
  const bottom = py + ph;

  const validVals = series.values.filter((v): v is number => v !== null && v > 0);
  const max = validVals.length ? Math.max(...validVals) : 0;
  const yMax = max > 0 ? max * 1.15 : 100;

  // Horizontal Grid Lines
  for (let i = 0; i <= 3; i++) {
    const gy = py + (ph * i) / 3;
    ctx.strokeStyle = 'rgba(216, 180, 254, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, gy);
    ctx.lineTo(px + pw, gy);
    ctx.stroke();
    txt(ctx, max > 0 ? fmt(yMax * (1 - i / 3)) : (i === 3 ? '0' : ''), px - 12, gy + 4, 11, C.textDim, false, 'right');
  }

  // Render 3D Cartoon Bars
  const count = Math.max(1, series.values.length);
  const slotW = pw / count;
  const barW = Math.max(12, Math.min(26, slotW * 0.62));

  series.values.forEach((raw, i) => {
    const value = raw ?? 0;
    const bh = max > 0 ? Math.max(value > 0 ? 8 : 4, (value / yMax) * (ph - 6)) : 4;
    const bx = px + slotW * i + (slotW - barW) / 2;
    const by = bottom - bh;

    const g = ctx.createLinearGradient(0, by, 0, bottom);
    g.addColorStop(0, '#FFFFFF');
    g.addColorStop(0.2, '#F472B6');
    g.addColorStop(0.65, '#A855F7');
    g.addColorStop(1, '#3B0764');

    ctx.save();
    if (value > 0) {
      ctx.shadowColor = '#D946EF';
      ctx.shadowBlur = 10;
    }
    rr(ctx, bx, by, barW, bh, Math.min(6, barW / 2), g, value > 0 ? '#FFFFFF' : 'rgba(216, 180, 254, 0.2)', 1.2);
    ctx.restore();
  });

  // Record Peak Badge (carefully clamped to never overflow top header)
  if (max > 0) {
    const peakIdx = series.values.indexOf(max);
    const pbx = px + slotW * peakIdx + slotW / 2;
    const pby = bottom - (max / yMax) * (ph - 6);
    const pillW = 105, pillH = 32;
    const pillX = Math.max(px, Math.min(px + pw - pillW, pbx - pillW / 2));
    const pillY = Math.max(py + 6, pby - 38);

    rr(ctx, pillX, pillY, pillW, pillH, 8, '#3B0764', '#F472B6', 1.8);
    txt(ctx, fmt(max), pillX + pillW / 2, pillY + 16, 13, '#FFFFFF', true, 'center');
    caps(ctx, 'RECORD PEAK', pillX + pillW / 2, pillY + 27, 8, '#F0ABFC', 'center', 1.2);

    ctx.fillStyle = '#F472B6';
    ctx.beginPath();
    ctx.arc(pbx, pby, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // X-Axis Time Ticks
  const hours = (series.end - series.start) / 3_600_000;
  const ticks = hours <= 6 ? 6 : 8;
  for (let i = 0; i <= ticks; i++) {
    const ago = hours * (1 - i / ticks);
    const label = i === ticks ? 'NOW' : ago >= 1 ? `-${Math.round(ago)}h` : `-${Math.round(ago * 60)}m`;
    txt(ctx, label, px + (pw * i) / ticks, bottom + 24, 11, i === ticks ? '#F472B6' : C.textDim, false, 'center');
  }
}

function drawPerformancePanel(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number,
  gain: number | null, average: number | null, best: number | null, pace: number | null,
  assets: ClanAssets,
): void {
  drawCartoonCard(ctx, x, y, w, h, 22, C.panelBorderGlow, assets);

  drawVectorCrown(ctx, x + 34, y + 34, 18, '#FFFFFF', '#38BDF8', 2);
  caps(ctx, 'PERFORMANCE STATS', x + 56, y + 40, 15, '#FFFFFF', 'left', 1.8);

  rr(ctx, x + w - 135, y + 24, 110, 26, 13, 'rgba(88, 28, 135, 0.75)', '#D8B4FE', 1);
  caps(ctx, '24H TELEMETRY', x + w - 80, y + 41, 9, '#F5D0FE', 'center', 1.0);

  const rows = [
    { label: 'Total Stars Farmed', val: gain === null ? '—' : fmt(gain), tag: 'ACTIVE' },
    { label: 'Average Hourly Pace', val: average === null ? '—' : `${fmt(average)}/h`, tag: 'STABLE' },
    { label: 'Best Peak Spike', val: best === null ? '—' : fmt(best), tag: 'PEAK' },
    { label: 'Current Tempo Pace', val: pace === null ? '—' : `${fmt(pace)}/h`, tag: 'LIVE' },
  ];

  rows.forEach((r, i) => {
    const ry = y + 74 + i * 56;

    // Distinct background container per row
    rr(ctx, x + 18, ry - 14, w - 36, 48, 12, 'rgba(255, 255, 255, 0.04)', 'rgba(216, 180, 254, 0.12)', 1);

    drawVectorStar(ctx, x + 36, ry + 10, 6, '#F5D0FE', '#A855F7', 1.5);
    caps(ctx, r.label, x + 52, ry + 14, 11, C.textMuted, 'left', 1.2);

    txt(ctx, r.val, x + w - 105, ry + 16, 19, '#FFFFFF', true, 'right');

    // Dynamic tag pill
    rr(ctx, x + w - 88, ry - 2, 70, 22, 11, 'rgba(88, 28, 135, 0.85)', '#F472B6', 1);
    caps(ctx, r.tag, x + w - 53, ry + 13, 9, '#FFFFFF', 'center', 1.2);
  });
}

// ============================================================================
// MAIN RENDER EXPORTS
// ============================================================================

function eventMeta(subtitle: string, heading?: readonly [string, string]): { tag: string; event: string } {
  const parts = (subtitle ?? '').split(/[•|]/).map(s => s.trim()).filter(Boolean);
  const tag = (parts[0] ?? '').replace(/[\[\]]/g, '').slice(0, 24);
  const event = heading?.join(' ') ?? (parts.slice(1).join(' · ') || 'PET SIMULATOR 99 WAR');
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

  // Deep space MMORPG background
  ctx.fillStyle = C.bgVoid;
  ctx.fillRect(0, 0, w, h);
  drawCover(ctx, assets.background, 0, 0, w, h, 0.45);

  const vignette = ctx.createRadialGradient(w / 2, h / 2, 220, w / 2, h / 2, Math.max(w, h) * 0.75);
  vignette.addColorStop(0, 'rgba(26, 7, 46, 0.25)');
  vignette.addColorStop(1, 'rgba(6, 1, 12, 0.94)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  // Top Header
  drawContain(ctx, assets.logo, 35, 18, 105, 95, 1.0);
  txt(ctx, 'R3V0', 155, 66, 52, '#FFFFFF', true);
  caps(ctx, 'CLAN TELEMETRY & WAR ROOM', 157, 94, 13, '#F472B6', 'left', 2.6);

  const meta = eventMeta(subtitle, options.heading);
  rr(ctx, w - 280, 36, 115, 34, 17, 'rgba(88, 28, 135, 0.85)', '#D946EF', 1.5);
  caps(ctx, `${selectedTimeframe.toUpperCase()} WINDOW`, w - 222, 58, 10, '#FFFFFF', 'center', 1.4);

  rr(ctx, w - 150, 36, 115, 34, 17, 'rgba(4, 78, 72, 0.85)', '#2DD4BF', 1.5);
  caps(ctx, '● LIVE DATA', w - 92, 58, 10, '#99F6E4', 'center', 1.6);

  caps(ctx, meta.event, w - 40, 94, 11, '#E9D5FF', 'right', 1.6);
  caps(ctx, meta.tag ? `CLAN [${meta.tag}]` : '[R3V0 CLAN]', w - 40, 112, 9, C.textDim, 'right', 1.4);

  // Compute Timeframe Data Series
  const tf = getTimeframeConfig(selectedTimeframe);
  const now = options.now ?? Date.now();
  const series = historySeries(stats?.points, tf.totalMs, tf.buckets, now);
  const values = series.values.filter((v): v is number => v !== null && v >= 0);

  const current = num(stats?.current);
  const gain = values.length ? values.reduce((a, b) => a + b, 0) : null;
  const average = gain === null ? null : gain / (tf.totalMs / 3_600_000);
  const best = values.length ? Math.max(...values) : null;
  const last = series.values.length > 0 ? series.values[series.values.length - 1] ?? null : null;
  const pace = last === null ? null : last / (series.step / 3_600_000);
  const consistency = values.length ? values.filter(v => v > 0).length / values.length : null;

  const rank = validId(rivalry?.rank);
  const members = validId(rivalry?.totalMembers);
  const clanTotal = num(rivalry?.clanPoints);
  const userPoints = num(rivalry?.userPoints) ?? current;
  const share = clanTotal && clanTotal > 0 && userPoints !== null ? Math.min(100, Math.max(0, (userPoints / clanTotal) * 100)) : null;
  const lead = rivalry?.behind && num(rivalry.behind.lead) !== null ? num(rivalry.behind.lead) : null;

  // Mid Section (Symmetrical & strictly separated bounds)
  // Left Column (w: 430)
  drawPlayerProfileCard(ctx, 35, 125, 430, 210, title, meta.tag, rank, consistency, avatar, assets);
  drawCurrentStarsCard(ctx, 35, 355, 430, 210, current, assets);

  // Center Character Stage (w: 630, x: 485)
  drawCentralCharacterStage(ctx, 485, 125, 630, 440, avatar, assets, rank);

  // Right Column (w: 430, x: 1135)
  drawClanPositionCard(ctx, 1135, 125, 430, 210, rank, members, lead, assets);
  drawContributionCard(ctx, 1135, 355, 430, 210, userPoints, clanTotal, share, assets);

  // Bottom Section (y: 585, h: 365)
  drawContributionHistoryChart(ctx, 35, 585, 1040, 365, series, assets);
  drawPerformancePanel(ctx, 1095, 585, 470, 365, gain, average, best, pace, assets);

  // Footer
  caps(ctx, 'R3V0 INTELLIGENCE • OFFICIAL CLAN TELEMETRY', 40, 982, 9, C.textDim, 'left', 1.8);
  caps(ctx, 'PET SIMULATOR 99 • VERIFIED SECURE PIPELINE', w - 40, 982, 9, C.textDim, 'right', 1.8);

  return canvas.encode('png');
}

export async function renderPlayerCard(
  title: string,
  subtitle: string,
  avatarUrl: string | null,
  userId?: number | null,
  options: PlayerCardRenderOptions = {},
): Promise<Buffer> {
  const w = 640, h = 860, scale = options.scale === 1 ? 1 : 2;
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

  ctx.fillStyle = C.bgVoid;
  ctx.fillRect(0, 0, w, h);
  drawCover(ctx, assets.background, 0, 0, w, h, 0.45);

  drawContain(ctx, assets.logo, (w - 180) / 2, 24, 180, 90, 1.0);
  drawCartoonCard(ctx, 35, 130, 570, 680, 26, C.panelBorderGlow, assets);

  const platW = 380, platH = 110;
  drawContain(ctx, assets.platform, (w - platW) / 2, 380, platW, platH, 1.0);

  drawContain(ctx, assets.crystalCat ?? assets.cat, 50, 330, 110, 110, 1.0);
  drawContain(ctx, assets.bat, w - 160, 330, 110, 110, 1.0);
  drawContain(ctx, assets.angel, w - 140, 180, 90, 90, 1.0);

  drawContain(ctx, assets.crystals, 50, 420, 85, 85, 0.85);
  drawContainFlipped(ctx, assets.crystals, w - 135, 420, 85, 85, true, 0.85);

  if (avatar) {
    drawContain(ctx, avatar, (w - 220) / 2, 210, 220, 220, 1.0);
  }

  const pName = title || 'Player';
  txt(ctx, pName, w / 2, 535, fitText(ctx, pName, 480, 40), '#FFFFFF', true, 'center');
  caps(ctx, meta.tag ? `[${meta.tag}] CLAN ROSTER` : '[R3V0] SQUAD', w / 2, 565, 12, '#D8B4FE', 'center', 1.6);

  rr(ctx, w / 2 - 90, 595, 180, 40, 20, '#581C87', '#D946EF', 2);
  caps(ctx, options.rank ? `RANK #${options.rank}` : 'WARRIOR', w / 2, 620, 11, '#FFFFFF', 'center', 1.6);

  if (options.roleLabel) {
    rr(ctx, 65, 655, 510, 55, 16, 'rgba(15, 6, 26, 0.9)', '#A855F7', 1.5);
    caps(ctx, 'ASSIGNED ROLE', w / 2, 678, 9, C.textDim, 'center', 1.8);
    txt(ctx, options.roleLabel, w / 2, 698, 19, '#5EEAD4', true, 'center');
  }

  caps(ctx, 'R3V0 CLAN INTELLIGENCE', w / 2, 834, 10, C.textDim, 'center', 2.0);

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

  ctx.fillStyle = C.bgVoid;
  ctx.fillRect(0, 0, w, h);
  drawCover(ctx, assets.background, 0, 0, w, h, 0.45);

  drawContain(ctx, assets.logo, 40, 20, 110, 85, 1.0);
  txt(ctx, 'RAP TRACKER', 165, 62, 38, '#FFFFFF', true);
  caps(ctx, 'PET VALUATION & MARKET INTELLIGENCE', 167, 88, 10, C.textMuted, 'left', 2.2);

  // Left Item Preview Card
  drawCartoonCard(ctx, 40, 125, 350, 515, 24, C.panelBorderGlow, assets);

  const img = await loadRemote(r.imageUrl);
  if (img) {
    drawContain(ctx, img, 65, 165, 300, 260, 1.0);
  } else {
    drawContain(ctx, assets.crystalCat, 90, 165, 250, 250, 1.0);
  }

  txt(ctx, r.name, 215, 470, fitText(ctx, r.name, 300, 30), '#FFFFFF', true, 'center');
  caps(ctx, 'TARGET ITEM', 215, 498, 9, C.textDim, 'center', 1.8);

  // Right Variants Card
  drawCartoonCard(ctx, 410, 125, 750, 515, 24, C.panelBorderGlow, assets);
  txt(ctx, 'MARKET VARIANTS', 445, 172, 24, '#FFFFFF', true);

  caps(ctx, 'VARIANT TYPE', 450, 208, 9, C.textDim, 'left', 1.8);
  caps(ctx, 'DIAMONDS (RAP)', 870, 208, 9, C.textDim, 'right', 1.8);
  caps(ctx, '24H DELTA', 1115, 208, 9, C.textDim, 'right', 1.8);

  const vars = Array.isArray(r.variants) ? r.variants.slice(0, 5) : [];
  vars.forEach((v, i) => {
    const yy = 224 + i * 72;
    rr(ctx, 440, yy, 690, 58, 16, 'rgba(15, 6, 26, 0.88)', 'rgba(216, 180, 254, 0.25)', 1.2);

    txt(ctx, v.label, 460, yy + 36, 21, '#FFFFFF', true);
    txt(ctx, num(v.value) === null ? '—' : fmt(v.value), 870, yy + 36, 23, '#FFF', true, 'right');

    const d = typeof v.delta === 'number' && Number.isFinite(v.delta) ? v.delta : null;
    const p = typeof v.deltaPct === 'number' && Number.isFinite(v.deltaPct) ? v.deltaPct : null;
    const isUp = (d ?? 0) >= 0;
    const str = d === null ? '—' : `${isUp ? '+' : ''}${fmt(d)}${p === null ? '' : ` (${isUp ? '+' : ''}${p.toFixed(1)}%)`}`;
    txt(ctx, str, 1110, yy + 36, 18, d === null ? C.textDim : isUp ? C.accentGreen : C.accentNeon, true, 'right');
  });

  caps(ctx, `BASELINE: ${r.baselineLabel ?? 'NORMAL'}`, 445, 608, 9, C.textDim, 'left', 1.8);

  return canvas.encode('png');
}
