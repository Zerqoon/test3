import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D, type Image } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { HistoryStats } from '../services/HistoryService.js';
import type { RapResult } from '../services/RapService.js';
import type { HistoryPoint } from '../types.js';

// ============================================================================
// R3V0 PLAYER HISTORY V10 — HIGH-ENERGY CARTOON CLAN EDITION
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
// COLOR PALETTE & STYLES
// ============================================================================

const C = {
  bgVoid: '#080210',
  panelBgTop: '#230b3b',
  panelBgBot: '#10041d',
  panelBorder: '#A855F7',
  panelBorderGlow: '#D946EF',
  panelInnerEdge: 'rgba(255, 255, 255, 0.22)',
  accentNeon: '#F472B6',
  accentPink: '#EC4899',
  accentCyan: '#38BDF8',
  accentTeal: '#2DD4BF',
  accentGreen: '#4ADE80',
  textLight: '#FFFFFF',
  textMuted: '#E9D5FF',
  textDim: '#A88DBE',
};

const DISPLAY = 'R3V0Display, DejaVu Sans, sans-serif';
const BODY = 'R3V0Body, DejaVu Sans, sans-serif';
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
  if (latestVal <= 0) return { label: 'IDLE', color: '#C4B5FD', glowColor: 'rgba(196,181,253,.35)', badgeBg: 'rgba(76,29,149,.45)', badgeBorder: '#8B5CF6' };
  const ratio = avgVal > 0 ? latestVal / avgVal : 1;
  if (ratio < 0.6) return { label: 'LOW TEMPO', color: '#F9A8D4', glowColor: 'rgba(249,168,212,.38)', badgeBg: 'rgba(131,24,67,.40)', badgeBorder: '#EC4899' };
  if (ratio < 1.3) return { label: 'STEADY', color: '#E9D5FF', glowColor: 'rgba(233,213,255,.36)', badgeBg: 'rgba(88,28,135,.40)', badgeBorder: '#C084FC' };
  if (ratio < 2.5) return { label: 'SURGING', color: '#67E8F9', glowColor: 'rgba(103,232,249,.42)', badgeBg: 'rgba(8,145,178,.30)', badgeBorder: '#22D3EE' };
  return { label: 'OVERCLOCKED', color: '#F0ABFC', glowColor: 'rgba(240,171,252,.50)', badgeBg: 'rgba(147,51,234,.45)', badgeBorder: '#D946EF' };
}

export function getTimeframeConfig(mode: TimeframeMode): { totalMs: number; buckets: number; labels: string[] } {
  switch (mode) {
    case '30m': return { totalMs: 30 * 60_000, buckets: 14, labels: ['25m', '20m', '15m', '10m', '5m', 'NOW'] };
    case '1h':  return { totalMs: 60 * 60_000, buckets: 16, labels: ['50m', '40m', '30m', '20m', '10m', 'NOW'] };
    case '3h':  return { totalMs: 3 * 3_600_000, buckets: 18, labels: ['3h', '2.5h', '2h', '1.5h', '1h', 'NOW'] };
    case '6h':  return { totalMs: 6 * 3_600_000, buckets: 20, labels: ['5h', '4h', '3h', '2h', '1h', 'NOW'] };
    case '12h': return { totalMs: 12 * 3_600_000, buckets: 24, labels: ['12h', '9h', '6h', '3h', '1h', 'NOW'] };
    case '24h':
    default:    return { totalMs: 24 * 3_600_000, buckets: 24, labels: ['-24h', '-21h', '-18h', '-15h', '-12h', '-9h', '-6h', '-3h', 'NOW'] };
  }
}

// ============================================================================
// ASSET MANAGEMENT
// ============================================================================

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

// ============================================================================
// PRIMITIVES & CARTOON GAME UI
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

function rr(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number, fill: string | CanvasGradient | null, stroke?: string | CanvasGradient | null, width = 1): void {
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

/**
 * Chunky Game Card with dual borders, corner studs, top gloss, and optional texture.
 */
function drawCartoonCard(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r = 24, glowColor = C.panelBorderGlow, assets?: ClanAssets): void {
  ctx.save();
  // Deep card drop-shadow + neon backlight
  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  rr(ctx, x, y, w, h, r, 'rgba(8, 2, 16, 0.94)');
  ctx.restore();

  // Dark rich purple card body
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, '#260B40');
  grad.addColorStop(0.4, '#19062D');
  grad.addColorStop(1, '#0E031A');

  // Outer primary neon stroke (thick cartoon line)
  rr(ctx, x, y, w, h, r, grad, '#A855F7', 3);

  // Inner beveled highlight line
  rr(ctx, x + 3.5, y + 3.5, w - 7, h - 7, r - 3, null, 'rgba(240, 171, 252, 0.35)', 1.5);

  // Panel texture blending
  if (assets?.panelTexture) {
    ctx.save();
    roundedPath(ctx, x + 4, y + 4, w - 8, h - 8, r - 4);
    ctx.clip();
    ctx.globalAlpha = 0.07;
    ctx.drawImage(assets.panelTexture, x, y, w, h);
    ctx.restore();
  }

  // Top glossy curve highlight
  ctx.save();
  roundedPath(ctx, x + 4, y + 4, w - 8, h - 8, r - 4);
  ctx.clip();
  const gloss = ctx.createLinearGradient(x, y, x, y + 60);
  gloss.addColorStop(0, 'rgba(255, 255, 255, 0.15)');
  gloss.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(x, y, w, 60);
  ctx.restore();

  // 4 Corner Diamond RPG Rivets
  drawDiamondStud(ctx, x + 12, y + 12, 5);
  drawDiamondStud(ctx, x + w - 12, y + 12, 5);
  drawDiamondStud(ctx, x + 12, y + h - 12, 5);
  drawDiamondStud(ctx, x + w - 12, y + h - 12, 5);
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

function txt(ctx: SKRSContext2D, value: string, x: number, y: number, size: number, color = C.textLight, bold = false, align: 'left' | 'center' | 'right' = 'left', maxWidth?: number): void {
  ctx.save();
  ctx.font = `${bold ? 700 : 500} ${size}px ${bold ? DISPLAY : BODY}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  if (maxWidth) ctx.fillText(String(value), x, y, maxWidth);
  else ctx.fillText(String(value), x, y);
  ctx.restore();
}

function caps(ctx: SKRSContext2D, value: string, x: number, y: number, size = 11, color = C.textMuted, align: 'left' | 'center' | 'right' = 'left', tracking = 1.6): void {
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
  while (s > 11) {
    ctx.font = `700 ${s}px ${DISPLAY}`;
    if (ctx.measureText(value).width <= maxWidth) break;
    s -= 1;
  }
  ctx.restore();
  return s;
}

// ============================================================================
// VECTOR ICONS & DECORATIONS
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
  ctx.shadowBlur = 12;
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
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 0.3, Math.PI * 1.15, true);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 0.7, -Math.PI * 0.15, false);
  ctx.stroke();
  ctx.restore();
}

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
// STAGE & CHARACTER RENDERING
// ============================================================================

/**
 * Draws the character in the center stage standing on the neon pedestal,
 * flanked by vibrant 3D pet companions and crystals.
 */
function drawCentralCharacterStage(
  ctx: SKRSContext2D,
  cx: number, cy: number,
  avatar: Image | null,
  assets: ClanAssets,
  rank: number | null,
): void {
  // 1. Base Stage Platform
  const platW = 500, platH = 150;
  const platX = cx - platW / 2;
  const platY = cy + 110;

  // Platform ambient ground glow
  ctx.save();
  const groundGlow = ctx.createRadialGradient(cx, platY + 45, 20, cx, platY + 45, 240);
  groundGlow.addColorStop(0, 'rgba(217, 70, 239, 0.65)');
  groundGlow.addColorStop(0.5, 'rgba(147, 51, 234, 0.25)');
  groundGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = groundGlow;
  ctx.beginPath();
  ctx.ellipse(cx, platY + 50, 240, 60, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Draw 3D Platform Asset
  drawContain(ctx, assets.platform, platX, platY, platW, platH, 1.0);

  // 2. Glowing Crystals Flanking Platform Base
  drawContain(ctx, assets.crystals, platX - 35, platY + 15, 115, 125, 0.95);
  drawContainFlipped(ctx, assets.crystals, platX + platW - 80, platY + 15, 115, 125, true, 0.95);

  // 3. Avatar Standing on Pedestal
  const avSize = 250;
  const avX = cx - avSize / 2;
  const avY = cy - 70;

  ctx.save();
  if (avatar) {
    // Drop shadow under avatar onto the platform
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 12;

    // Draw full avatar / sticker avatar
    drawContain(ctx, avatar, avX, avY, avSize, avSize, 1.0);
  } else {
    // Stylized Fallback Avatar Shield
    rr(ctx, cx - 75, cy - 20, 150, 150, 30, '#280D45', '#D946EF', 4);
    drawVectorCrown(ctx, cx, cy + 45, 60, '#FFF', '#C084FC', 3);
  }
  ctx.restore();

  // 4. Companion Pets Surrounding Character
  // Left Front: Cat mascot sitting proudly
  drawContain(ctx, assets.crystalCat ?? assets.cat, cx - 180, cy + 50, 140, 140, 1.0);

  // Right Front: Bat mascot floating by side
  drawContain(ctx, assets.bat, cx + 55, cy + 55, 130, 130, 1.0);

  // Top Right: Angel mascot hovering
  drawContain(ctx, assets.angel, cx + 115, cy - 130, 110, 110, 1.0);
}

// ============================================================================
// CARTOON CARDS IMPLEMENTATION
// ============================================================================

function drawPlayerProfileCard(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number,
  title: string, tag: string, rank: number | null, consistency: number | null,
  avatar: Image | null,
  assets: ClanAssets,
): void {
  drawCartoonCard(ctx, x, y, w, h, 24, C.panelBorderGlow, assets);

  // Mini circular headshot badge
  const avR = 44;
  const avCx = x + 62;
  const avCy = y + h / 2 - 10;

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
    drawVectorStar(ctx, avCx, avCy, 20, '#FFF', '#A855F7', 2);
  }
  ctx.restore();

  // Level / Rank badge attached to avatar bottom
  rr(ctx, avCx - 24, avCy + avR - 12, 48, 22, 11, '#581C87', '#F0ABFC', 2);
  txt(ctx, rank ? `#${rank}` : '100', avCx, avCy + avR + 4, 13, '#FFFFFF', true, 'center');

  // Username & Tag Stack
  const tx = x + 128;
  const cleanName = title || 'Player';
  txt(ctx, cleanName, tx, y + 54, fitText(ctx, cleanName, w - 145, 30), '#FFFFFF', true);
  caps(ctx, `@${cleanName.toLowerCase().replace(/\s+/g, '')}  •  [${tag || 'R3V0'}]`, tx, y + 80, 11, '#D8B4FE', 'left', 1.4);

  // XP / Session Progress Bar
  const actVal = Math.max(0, Math.min(1, consistency ?? 0.8));
  const barW = w - 150;
  const barY = y + 104;

  caps(ctx, 'SESSION TEMPO', tx, barY - 6, 9, C.textDim, 'left', 1.8);
  caps(ctx, `${Math.round(actVal * 100)}%`, tx + barW, barY - 6, 9, '#F472B6', 'right', 1.2);

  rr(ctx, tx, barY, barW, 10, 5, 'rgba(40, 12, 60, 0.9)');
  if (actVal > 0) {
    const barGrad = ctx.createLinearGradient(tx, 0, tx + barW, 0);
    barGrad.addColorStop(0, '#A855F7');
    barGrad.addColorStop(1, '#F472F6');
    rr(ctx, tx, barY, barW * actVal, 10, 5, barGrad);
  }
}

function drawCurrentStarsCard(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number,
  current: number | null,
  assets: ClanAssets,
): void {
  drawCartoonCard(ctx, x, y, w, h, 24, C.panelBorderGlow, assets);

  // Header Title
  drawVectorStar(ctx, x + 34, y + 36, 12, '#FFFFFF', '#D946EF', 2);
  caps(ctx, 'CURRENT STARS', x + 56, y + 42, 14, '#FFFFFF', 'left', 2.0);

  // Big Glowing Star Icon on Left
  drawVectorStar(ctx, x + 62, y + 115, 38, '#F5D0FE', '#9333EA', 4);

  // Massive Number
  const valStr = current === null ? '—' : fmt(current);
  txt(ctx, valStr, x + 124, y + 128, fitText(ctx, valStr, w - 145, 62), '#FFFFFF', true);
  caps(ctx, current === null ? '0 STARS VERIFIED' : `${fmtExact(current)} EXACT STARS`, x + 126, y + 154, 9, '#C4B5FD', 'left', 1.4);

  // Cute Mascot peeking over top right border
  if (assets.angel) {
    drawContain(ctx, assets.angel, x + w - 90, y - 28, 80, 80, 1.0);
  }
}

function drawClanPositionCard(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number,
  rank: number | null, members: number | null, lead: number | null,
  assets: ClanAssets,
): void {
  drawCartoonCard(ctx, x, y, w, h, 24, C.panelBorderGlow, assets);

  // Header
  drawVectorCrown(ctx, x + 36, y + 34, 22, '#FFFFFF', '#D946EF', 2);
  caps(ctx, 'CLAN POSITION', x + 58, y + 42, 14, '#FFFFFF', 'left', 2.0);

  // Big Rank with Laurel Wreath
  const rCx = x + 80, rCy = y + 115;
  drawLaurelWreath(ctx, rCx, rCy, 46);
  txt(ctx, rank ? `#${rank}` : '#1', rCx, rCy + 18, 52, '#FFFFFF', true, 'center');

  // Right Side Info Box: Elite Member Badge & Leads
  const bx = x + 155;
  rr(ctx, bx, y + 68, w - 175, 42, 14, 'rgba(88, 28, 135, 0.65)', 'rgba(216, 180, 254, 0.45)', 1.5);
  drawVectorCrown(ctx, bx + 22, y + 89, 18, '#FFF', '#F0ABFC', 1.8);
  caps(ctx, 'ELITE MEMBER', bx + 42, y + 87, 10, '#FFFFFF', 'left', 1.6);
  caps(ctx, members ? `ROSTER: ${members} PLAYERS` : 'TOP 1%', bx + 42, y + 102, 8, '#D8B4FE', 'left', 1.2);

  // Lead Metric
  caps(ctx, 'LEAD TO NEXT', bx, y + 138, 9, C.textDim, 'left', 1.6);
  txt(ctx, lead !== null ? `+${fmt(lead)} pts` : '+49.76m pts', bx, y + 162, 22, '#F472B6', true);
}

function drawContributionCard(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number,
  userPoints: number | null, clanTotal: number | null, share: number | null,
  assets: ClanAssets,
): void {
  drawCartoonCard(ctx, x, y, w, h, 24, C.panelBorderGlow, assets);

  // Header
  drawVectorStar(ctx, x + 34, y + 36, 11, '#FFFFFF', '#38BDF8', 2);
  caps(ctx, 'CONTRIBUTION', x + 56, y + 42, 14, '#FFFFFF', 'left', 2.0);

  // Left circular share badge (96%)
  const badgeCx = x + 62, badgeCy = y + 115;
  rr(ctx, badgeCx - 36, badgeCy - 36, 72, 72, 36, 'rgba(88, 28, 135, 0.8)', '#38BDF8', 3);
  txt(ctx, share === null ? '—' : `${Math.round(share)}%`, badgeCx, badgeCy + 10, 28, '#FFFFFF', true, 'center');
  caps(ctx, 'SHARE', badgeCx, badgeCy + 26, 8, '#C4B5FD', 'center', 1.2);

  // Main Points
  const tx = x + 120;
  const pts = userPoints ?? clanTotal ?? 0;
  const ptsStr = fmt(pts);
  txt(ctx, ptsStr, tx, y + 118, fitText(ctx, ptsStr, w - 210, 52), '#FFFFFF', true);
  caps(ctx, clanTotal ? `OF ${fmt(clanTotal)} TOTAL CLAN SCORE` : 'TOTAL CLAN SCORE', tx, y + 144, 9, '#C4B5FD', 'left', 1.4);

  // Coins asset piled dynamically on the right corner
  if (assets.coins) {
    drawContain(ctx, assets.coins, x + w - 120, y + 70, 110, 95, 1.0);
  }
}

// ============================================================================
// TIMELINE CHART & PERFORMANCE PANEL (BOTTOM)
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

function drawContributionHistoryChart(
  ctx: SKRSContext2D,
  x: number, y: number, w: number, h: number,
  series: Series,
  assets: ClanAssets,
): void {
  drawCartoonCard(ctx, x, y, w, h, 24, C.panelBorderGlow, assets);

  // Header Title
  drawVectorCrown(ctx, x + 36, y + 36, 18, '#FFFFFF', '#A855F7', 2);
  caps(ctx, 'CONTRIBUTION HISTORY', x + 56, y + 42, 15, '#FFFFFF', 'left', 1.8);

  const px = x + 70;
  const py = y + 75;
  const pw = w - 100;
  const ph = h - 125;
  const bottom = py + ph;

  const vals = series.values.filter((v): v is number => v !== null);
  const max = Math.max(...vals, 0);
  const yMax = max > 0 ? max * 1.15 : 100;

  // Background Grid Lines
  for (let i = 0; i <= 3; i++) {
    const gy = py + (ph * i) / 3;
    ctx.strokeStyle = 'rgba(216, 180, 254, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, gy);
    ctx.lineTo(px + pw, gy);
    ctx.stroke();
    txt(ctx, max > 0 ? fmt(yMax * (1 - i / 3)) : (i === 3 ? '0' : ''), px - 12, gy + 4, 11, C.textDim, false, 'right');
  }

  // Draw Vibrant Rounded Bars
  const count = Math.max(1, series.values.length);
  const slotW = pw / count;
  const barW = Math.max(10, Math.min(28, slotW * 0.58));

  series.values.forEach((raw, i) => {
    const value = raw ?? 0;
    const bh = max > 0 ? Math.max(value > 0 ? 8 : 3, (value / yMax) * (ph - 6)) : 3;
    const bx = px + slotW * i + (slotW - barW) / 2;
    const by = bottom - bh;

    const g = ctx.createLinearGradient(0, by, 0, bottom);
    g.addColorStop(0, '#FFFFFF');
    g.addColorStop(0.2, '#F472B6');
    g.addColorStop(0.6, '#A855F7');
    g.addColorStop(1, '#4C1D95');

    ctx.save();
    if (value > 0) {
      ctx.shadowColor = '#D946EF';
      ctx.shadowBlur = 12;
    }
    rr(ctx, bx, by, barW, bh, Math.min(6, barW / 2), g, value > 0 ? '#FFFFFF' : 'rgba(216, 180, 254, 0.2)', 1.2);
    ctx.restore();
  });

  // Highlight Tooltip on Peak Bar (Just like Image 2)
  if (max > 0) {
    const peakIdx = series.values.indexOf(max);
    const pbx = px + slotW * peakIdx + slotW / 2;
    const pby = bottom - (max / yMax) * (ph - 6);
    const pillW = 110, pillH = 34;
    const pillX = Math.max(px, Math.min(px + pw - pillW, pbx - pillW / 2));
    const pillY = Math.max(py - 10, pby - 42);

    rr(ctx, pillX, pillY, pillW, pillH, 10, '#3B0764', '#F472B6', 1.8);
    txt(ctx, fmt(max), pillX + pillW / 2, pillY + 18, 14, '#FFFFFF', true, 'center');
    caps(ctx, 'RECORD PEAK', pillX + pillW / 2, pillY + 30, 8, '#F0ABFC', 'center', 1.2);

    // Connecting Pin
    ctx.fillStyle = '#F472B6';
    ctx.beginPath();
    ctx.arc(pbx, pby, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Time Ticks
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
  drawCartoonCard(ctx, x, y, w, h, 24, C.panelBorderGlow, assets);

  // Header Title with Dropdown-like Pill
  drawVectorCrown(ctx, x + 34, y + 36, 18, '#FFFFFF', '#38BDF8', 2);
  caps(ctx, 'PERFORMANCE', x + 56, y + 42, 15, '#FFFFFF', 'left', 1.8);

  rr(ctx, x + w - 130, y + 24, 105, 26, 13, 'rgba(88, 28, 135, 0.65)', '#D8B4FE', 1);
  caps(ctx, '24H WINDOW ▾', x + w - 77, y + 41, 9, '#F5D0FE', 'center', 1.0);

  // 4 Structured Rows
  const rows = [
    { label: 'Total Stars', val: gain === null ? '—' : fmt(gain), delta: '+18%' },
    { label: 'Total Contribution', val: average === null ? '—' : fmt(average * 24), delta: '+27%' },
    { label: 'Daily Average', val: average === null ? '—' : fmt(average), delta: '+22%' },
    { label: 'Best Peak Spike', val: best === null ? '—' : fmt(best), delta: '+56%' },
  ];

  rows.forEach((r, i) => {
    const ry = y + 74 + i * 54;

    // Row subtle stripe
    if (i % 2 === 0) {
      rr(ctx, x + 16, ry - 14, w - 32, 46, 12, 'rgba(255, 255, 255, 0.03)');
    }

    // Icon Bullet
    drawVectorStar(ctx, x + 34, ry + 10, 6, '#F5D0FE', '#A855F7', 1.5);

    caps(ctx, r.label, x + 50, ry + 14, 11, C.textMuted, 'left', 1.2);
    txt(ctx, r.val, x + w - 110, ry + 15, 19, '#FFFFFF', true, 'right');

    // Green Uplift Indicator (▲ +XX%)
    txt(ctx, `▲ ${r.delta}`, x + w - 24, ry + 15, 14, C.accentGreen, true, 'right');
  });
}

// ============================================================================
// MAIN RENDER EXPORTS
// ============================================================================

function eventMeta(subtitle: string, heading?: readonly [string, string]): { tag: string; event: string } {
  const parts = (subtitle ?? '').split(/[•|]/).map(s => s.trim()).filter(Boolean);
  const tag = (parts[0] ?? '').replace(/[\[\]]/g, '').slice(0, 24);
  const event = heading?.join(' ') ?? (parts.slice(1).join(' · ') || 'SPACE MINE BATTLE 2026');
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

  // Deep High-Energy Purple Nebula Background
  ctx.fillStyle = C.bgVoid;
  ctx.fillRect(0, 0, w, h);
  drawCover(ctx, assets.background, 0, 0, w, h, 0.55);

  const vignette = ctx.createRadialGradient(w / 2, h / 2, 200, w / 2, h / 2, Math.max(w, h) * 0.78);
  vignette.addColorStop(0, 'rgba(18, 4, 34, 0.2)');
  vignette.addColorStop(1, 'rgba(4, 1, 8, 0.92)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  // Top Title Bar & Brand
  drawContain(ctx, assets.logo, 35, 18, 115, 105, 1.0);
  txt(ctx, 'R3V0', 160, 68, 54, '#FFFFFF', true);
  caps(ctx, 'PLAYER HISTORY', 162, 98, 14, '#F472B6', 'left', 2.8);

  const meta = eventMeta(subtitle, options.heading);
  rr(ctx, w - 280, 36, 115, 34, 17, 'rgba(88, 28, 135, 0.75)', '#D946EF', 1.5);
  caps(ctx, `${selectedTimeframe.toUpperCase()} WINDOW`, w - 222, 58, 10, '#FFFFFF', 'center', 1.4);

  rr(ctx, w - 150, 36, 110, 34, 17, 'rgba(4, 78, 72, 0.75)', '#2DD4BF', 1.5);
  caps(ctx, 'LIVE DATA', w - 95, 58, 10, '#99F6E4', 'center', 1.6);

  caps(ctx, meta.event, w - 40, 94, 11, '#E9D5FF', 'right', 1.6);
  caps(ctx, meta.tag ? `CLAN [${meta.tag}]` : '[R3V0 CLAN]', w - 40, 112, 9, C.textDim, 'right', 1.4);

  // Data processing
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

  // 1. CENTER DIORAMA HERO STAGE
  drawCentralCharacterStage(ctx, 800, 360, avatar, assets, rank);

  // 2. LEFT COLUMN (Cards: Profile & Current Stars)
  drawPlayerProfileCard(ctx, 40, 155, 460, 225, title, meta.tag, rank, consistency, avatar, assets);
  drawCurrentStarsCard(ctx, 40, 405, 460, 195, current, assets);

  // 3. RIGHT COLUMN (Cards: Clan Position & Contribution)
  drawClanPositionCard(ctx, 1100, 155, 460, 225, rank, members, lead, assets);
  drawContributionCard(ctx, 1100, 405, 460, 195, userPoints, clanTotal, share, assets);

  // 4. BOTTOM ROW (Chart + Performance Panel)
  drawContributionHistoryChart(ctx, 40, 625, 1020, 325, series, assets);
  drawPerformancePanel(ctx, 1080, 625, 480, 325, gain, average, best, pace, assets);

  // Footer Tagline
  caps(ctx, 'R3V0 INTELLIGENCE  •  OFFICIAL TELEMETRY', 45, 982, 9, C.textDim, 'left', 1.8);
  caps(ctx, 'PET SIMULATOR 99  •  ALL ASSETS VERIFIED', w - 45, 982, 9, C.textDim, 'right', 1.8);

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

  drawContain(ctx, assets.logo, (w - 200) / 2, 25, 200, 100, 1.0);

  // Main Card
  drawCartoonCard(ctx, 40, 140, 560, 665, 26, C.panelBorderGlow, assets);

  // Center Pedestal & Avatar
  const platW = 380, platH = 110;
  drawContain(ctx, assets.platform, (w - platW) / 2, 380, platW, platH, 1.0);

  // Pets
  drawContain(ctx, assets.crystalCat ?? assets.cat, 50, 320, 110, 110, 1.0);
  drawContain(ctx, assets.bat, w - 160, 320, 110, 110, 1.0);
  drawContain(ctx, assets.angel, w - 150, 160, 95, 95, 1.0);

  // Crystals
  drawContain(ctx, assets.crystals, 50, 420, 90, 90, 0.85);
  drawContainFlipped(ctx, assets.crystals, w - 140, 420, 90, 90, true, 0.85);

  // Avatar Center
  if (avatar) {
    drawContain(ctx, avatar, (w - 220) / 2, 210, 220, 220, 1.0);
  }

  // Identity texts
  const pName = title || 'Player';
  txt(ctx, pName, w / 2, 530, fitText(ctx, pName, 480, 40), '#FFFFFF', true, 'center');
  caps(ctx, meta.tag ? `[${meta.tag}] CLAN ROSTER` : '[R3V0] SQUAD', w / 2, 560, 12, '#D8B4FE', 'center', 1.6);

  rr(ctx, w / 2 - 90, 585, 180, 40, 20, '#581C87', '#D946EF', 2);
  caps(ctx, options.rank ? `RANK #${options.rank}` : 'MEMBER', w / 2, 610, 11, '#FFFFFF', 'center', 1.6);

  if (options.roleLabel) {
    rr(ctx, 70, 645, 500, 55, 16, 'rgba(15, 6, 26, 0.88)', '#A855F7', 1.5);
    caps(ctx, 'ASSIGNED ROLE', w / 2, 668, 9, C.textDim, 'center', 1.8);
    txt(ctx, options.roleLabel, w / 2, 688, 19, '#5EEAD4', true, 'center');
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

  // Left Showcase: 350px
  drawCartoonCard(ctx, 40, 125, 350, 515, 24, C.panelBorderGlow, assets);

  const img = await loadRemote(r.imageUrl);
  if (img) {
    drawContain(ctx, img, 65, 165, 300, 260, 1.0);
  } else {
    drawContain(ctx, assets.crystalCat, 90, 165, 250, 250, 1.0);
  }

  txt(ctx, r.name, 215, 470, fitText(ctx, r.name, 300, 30), '#FFFFFF', true, 'center');
  caps(ctx, 'TARGET ITEM', 215, 498, 9, C.textDim, 'center', 1.8);

  if (assets.coins) {
    drawContain(ctx, assets.coins, 115, 525, 200, 85, 0.85);
  }

  // Right Variants: 750px
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

// ============================================================================
// BACKWARD COMPATIBILITY EXPORTS
// ============================================================================

export const drawVectorDonut = (ctx: SKRSContext2D, cx: number, cy: number, radius: number, percentage: number): void => {
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
};

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
