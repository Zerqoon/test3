import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D, type Image } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import type { HistoryStats } from '../services/HistoryService.js';
import type { RapResult } from '../services/RapService.js';
import type { HistoryPoint } from '../types.js';

// ============================================================================
// R3V0 PURE VECTOR ENGINE V11 — HIGH-ENERGY CARTOON PS99 EDITION
// Zero external asset dependencies. 100% procedural 4K graphics.
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
// COLOR PALETTE & FONTS
// ============================================================================

const C = {
  bgDark: '#080114',
  panelBgTop: '#24083D',
  panelBgMid: '#160429',
  panelBgBot: '#0C0217',
  panelBevel: '#05000A',
  panelBorder: '#A855F7',
  panelGlow: '#D946EF',
  accentPink: '#F472B6',
  accentNeon: '#EC4899',
  accentCyan: '#38BDF8',
  accentTeal: '#2DD4BF',
  accentGreen: '#4ADE80',
  accentGold: '#FBBF24',
  textLight: '#FFFFFF',
  textMuted: '#E9D5FF',
  textDim: '#A88DBE',
};

const DISPLAY = 'R3V0Display, Montserrat, Arial Black, sans-serif';
const BODY = 'R3V0Body, Inter, Segoe UI, sans-serif';
let fontsLoaded = false;

function registerOptionalFonts(directory?: string): void {
  if (fontsLoaded) return;
  const p = directory ? resolve(directory, 'fonts') : resolve(process.cwd(), 'assets/fonts');
  if (existsSync(p)) {
    try {
      const displayPath = resolve(p, 'BarlowCondensed-SemiBold.ttf');
      const bodyPath = resolve(p, 'Barlow-SemiBold.ttf');
      if (existsSync(displayPath)) GlobalFonts.registerFromPath(displayPath, 'R3V0Display');
      if (existsSync(bodyPath)) GlobalFonts.registerFromPath(bodyPath, 'R3V0Body');
    } catch { /* fallback to system font stack */ }
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
  if (abs >= 1e3) return `${(val / 1e3).toFixed(1)}k`;
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
    default:    return { totalMs: 24 * 3_600_000, buckets: 24, labels: ['-24h', '-20h', '-16h', '-12h', '-8h', '-4h', 'NOW'] };
  }
}

// ============================================================================
// VECTOR DRAWING PRIMITIVES
// ============================================================================

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

function rr(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number, fill?: string | CanvasGradient | null, stroke?: string | CanvasGradient | null, strokeWidth = 1): void {
  ctx.save();
  roundedPath(ctx, x, y, w, h, r);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = strokeWidth; ctx.stroke(); }
  ctx.restore();
}

function drawDiamondStud(ctx: SKRSContext2D, cx: number, cy: number, size = 6, color = '#FFFFFF'): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = color;
  ctx.shadowColor = C.panelGlow;
  ctx.shadowBlur = 6;
  ctx.fillRect(-size / 2, -size / 2, size, size);
  ctx.restore();
}

function txt(ctx: SKRSContext2D, text: string, x: number, y: number, size: number, color = C.textLight, bold = false, align: 'left' | 'center' | 'right' = 'left', maxW?: number): void {
  ctx.save();
  ctx.font = `${bold ? 700 : 500} ${size}px ${bold ? DISPLAY : BODY}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  if (maxW) ctx.fillText(text, x + 1.5, y + 2, maxW);
  else ctx.fillText(text, x + 1.5, y + 2);
  ctx.fillStyle = color;
  if (maxW) ctx.fillText(text, x, y, maxW);
  else ctx.fillText(text, x, y);
  ctx.restore();
}

function caps(ctx: SKRSContext2D, text: string, x: number, y: number, size = 11, color = C.textMuted, align: 'left' | 'center' | 'right' = 'left', tracking = 1.6): void {
  ctx.save();
  const t = String(text).toUpperCase();
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
// CHUNKY 3D CARTOON PANEL
// ============================================================================

function drawCartoonCard(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r = 22): void {
  const bevelH = 6;
  const faceH = h - bevelH;

  // 1. Dark Bevel Base / Drop Shadow
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  rr(ctx, x, y + bevelH, w, faceH, r, C.panelBevel);
  ctx.restore();

  // 2. Card Surface Gradient
  const grad = ctx.createLinearGradient(x, y, x, y + faceH);
  grad.addColorStop(0, C.panelBgTop);
  grad.addColorStop(0.4, C.panelBgMid);
  grad.addColorStop(1, C.panelBgBot);
  rr(ctx, x, y, w, faceH, r, grad, C.panelBorder, 3);
  rr(ctx, x + 3.5, y + 3.5, w - 7, faceH - 7, r - 3, null, 'rgba(240, 171, 252, 0.35)', 1.5);

  // 3. Crisp Hexagonal / Pattern Texture Overlay
  ctx.save();
  roundedPath(ctx, x + 4, y + 4, w - 8, faceH - 8, r - 4);
  ctx.clip();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
  const step = 20;
  for (let py = y; py < y + faceH; py += step) {
    for (let px = x; px < x + w; px += step) {
      if ((Math.floor(px / step) + Math.floor(py / step)) % 2 === 0) {
        ctx.fillRect(px, py, step / 2, step / 2);
      }
    }
  }

  // 4. Gloss shine
  const gloss = ctx.createLinearGradient(x, y, x, y + 55);
  gloss.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
  gloss.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(x, y, w, 55);
  ctx.restore();

  // 5. Gem Studs
  drawDiamondStud(ctx, x + 12, y + 12, 5);
  drawDiamondStud(ctx, x + w - 12, y + 12, 5);
  drawDiamondStud(ctx, x + 12, y + faceH - 12, 5);
  drawDiamondStud(ctx, x + w - 12, y + faceH - 12, 5);
}

// ============================================================================
// PROCEDURAL PS99 PETS & STAGE ASSETS (100% IN-ENGINE)
// ============================================================================

export function drawVectorStar(ctx: SKRSContext2D, cx: number, cy: number, radius: number, fill = '#FFF', stroke = '#A855F7', lw = 3): void {
  ctx.save();
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (-90 + i * 72) * Math.PI / 180;
    const b = (-54 + i * 72) * Math.PI / 180;
    ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    ctx.lineTo(cx + Math.cos(b) * radius * 0.44, cy + Math.sin(b) * radius * 0.44);
  }
  ctx.closePath();
  ctx.shadowColor = C.panelGlow;
  ctx.shadowBlur = 10;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function drawVectorCrown(ctx: SKRSContext2D, cx: number, cy: number, width: number, fill = '#FBBF24', stroke = '#D97706'): void {
  const h = width * 0.6;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(cx - width / 2, cy + h / 2);
  ctx.lineTo(cx - width / 2, cy - h * 0.2);
  ctx.lineTo(cx - width * 0.25, cy + h * 0.1);
  ctx.lineTo(cx, cy - h / 2);
  ctx.lineTo(cx + width * 0.25, cy + h * 0.1);
  ctx.lineTo(cx + width / 2, cy - h * 0.2);
  ctx.lineTo(cx + width / 2, cy + h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawProceduralCrystal(ctx: SKRSContext2D, cx: number, cy: number, size: number, color1 = '#E879F9', color2 = '#818CF8'): void {
  ctx.save();
  ctx.translate(cx, cy);
  const w = size * 0.5, h = size;
  ctx.shadowColor = color1;
  ctx.shadowBlur = 14;

  // Left facet
  ctx.beginPath();
  ctx.moveTo(0, -h / 2);
  ctx.lineTo(-w, 0);
  ctx.lineTo(0, h / 2);
  ctx.closePath();
  ctx.fillStyle = color1;
  ctx.fill();

  // Right facet
  ctx.beginPath();
  ctx.moveTo(0, -h / 2);
  ctx.lineTo(w, 0);
  ctx.lineTo(0, h / 2);
  ctx.closePath();
  ctx.fillStyle = color2;
  ctx.fill();

  // Center specular line
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -h / 2);
  ctx.lineTo(0, h / 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * Pet Simulator 99 Iconic Block Pet: Crystal Cat
 */
function drawPetCat(ctx: SKRSContext2D, cx: number, cy: number, size = 110): void {
  ctx.save();
  ctx.translate(cx, cy);
  const s = size;

  // Shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.beginPath();
  ctx.ellipse(0, s * 0.52, s * 0.48, s * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();

  // Ears
  const earW = s * 0.28, earH = s * 0.32;
  ctx.fillStyle = '#C084FC';
  ctx.strokeStyle = '#581C87';
  ctx.lineWidth = 3;
  // Left ear
  ctx.beginPath();
  ctx.moveTo(-s * 0.4, -s * 0.3);
  ctx.lineTo(-s * 0.25, -s * 0.6);
  ctx.lineTo(-s * 0.1, -s * 0.35);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Right ear
  ctx.beginPath();
  ctx.moveTo(s * 0.4, -s * 0.3);
  ctx.lineTo(s * 0.25, -s * 0.6);
  ctx.lineTo(s * 0.1, -s * 0.35);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  // Inner ears
  ctx.fillStyle = '#F472B6';
  ctx.beginPath();
  ctx.moveTo(-s * 0.35, -s * 0.32);
  ctx.lineTo(-s * 0.25, -s * 0.52);
  ctx.lineTo(-s * 0.16, -s * 0.36);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(s * 0.35, -s * 0.32);
  ctx.lineTo(s * 0.25, -s * 0.52);
  ctx.lineTo(s * 0.16, -s * 0.36);
  ctx.closePath();
  ctx.fill();

  // Sześcienne ciało (Block Head)
  const g = ctx.createLinearGradient(0, -s * 0.45, 0, s * 0.45);
  g.addColorStop(0, '#E879F9');
  g.addColorStop(1, '#7E22CE');
  rr(ctx, -s * 0.45, -s * 0.45, s * 0.9, s * 0.9, s * 0.24, g, '#3B0764', 3.5);

  // Big Shiny Eyes
  const eyeR = s * 0.12;
  [-s * 0.22, s * 0.22].forEach(ex => {
    ctx.fillStyle = '#1E1B4B';
    ctx.beginPath();
    ctx.arc(ex, -s * 0.05, eyeR, 0, Math.PI * 2);
    ctx.fill();
    // Catchlight
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(ex - eyeR * 0.3, -s * 0.05 - eyeR * 0.3, eyeR * 0.45, 0, Math.PI * 2);
    ctx.fill();
  });

  // Pink Nose & Cat Mouth :3
  ctx.fillStyle = '#F472B6';
  ctx.beginPath();
  ctx.arc(0, s * 0.1, s * 0.045, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#3B0764';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(-s * 0.06, s * 0.18, s * 0.06, 0.2, Math.PI * 0.9);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(s * 0.06, s * 0.18, s * 0.06, 0.1, Math.PI * 0.8);
  ctx.stroke();

  // Forehead Gem
  drawProceduralCrystal(ctx, 0, -s * 0.26, s * 0.22, '#38BDF8', '#818CF8');
  ctx.restore();
}

/**
 * Pet Simulator 99 Block Pet: Demon Bat
 */
function drawPetBat(ctx: SKRSContext2D, cx: number, cy: number, size = 110): void {
  ctx.save();
  ctx.translate(cx, cy);
  const s = size;

  // Shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.beginPath();
  ctx.ellipse(0, s * 0.52, s * 0.48, s * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();

  // Bat Wings
  ctx.fillStyle = '#311042';
  ctx.strokeStyle = '#A855F7';
  ctx.lineWidth = 2.5;
  // Left Wing
  ctx.beginPath();
  ctx.moveTo(-s * 0.4, 0);
  ctx.quadraticCurveTo(-s * 0.8, -s * 0.4, -s * 0.85, -s * 0.1);
  ctx.quadraticCurveTo(-s * 0.7, s * 0.2, -s * 0.4, s * 0.25);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Right Wing
  ctx.beginPath();
  ctx.moveTo(s * 0.4, 0);
  ctx.quadraticCurveTo(s * 0.8, -s * 0.4, s * 0.85, -s * 0.1);
  ctx.quadraticCurveTo(s * 0.7, s * 0.2, s * 0.4, s * 0.25);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  // Body
  const g = ctx.createLinearGradient(0, -s * 0.45, 0, s * 0.45);
  g.addColorStop(0, '#4C1D95');
  g.addColorStop(1, '#1E0B38');
  rr(ctx, -s * 0.42, -s * 0.42, s * 0.84, s * 0.84, s * 0.22, g, '#A855F7', 3);

  // Glowing Cyan Demon Eyes
  const eyeR = s * 0.11;
  [-s * 0.2, s * 0.2].forEach(ex => {
    ctx.shadowColor = '#38BDF8';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#38BDF8';
    ctx.beginPath();
    ctx.arc(ex, -s * 0.05, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(ex, -s * 0.05, eyeR * 0.4, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.shadowBlur = 0;

  // Little vampire fangs
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.moveTo(-s * 0.1, s * 0.16);
  ctx.lineTo(-s * 0.05, s * 0.28);
  ctx.lineTo(0, s * 0.16);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(0, s * 0.16);
  ctx.lineTo(s * 0.05, s * 0.28);
  ctx.lineTo(s * 0.1, s * 0.16);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Pet Simulator 99 Block Pet: Angel Wisp with Halo
 */
function drawPetAngel(ctx: SKRSContext2D, cx: number, cy: number, size = 95): void {
  ctx.save();
  ctx.translate(cx, cy);
  const s = size;

  // Floating Golden Halo
  ctx.strokeStyle = '#FBBF24';
  ctx.lineWidth = 4;
  ctx.shadowColor = '#FBBF24';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.55, s * 0.32, s * 0.1, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Angelic Wings
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.strokeStyle = '#F0ABFC';
  ctx.lineWidth = 2;
  // Left Wing
  ctx.beginPath();
  ctx.moveTo(-s * 0.35, -s * 0.1);
  ctx.quadraticCurveTo(-s * 0.75, -s * 0.5, -s * 0.7, 0);
  ctx.quadraticCurveTo(-s * 0.55, s * 0.3, -s * 0.35, s * 0.15);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  // Right Wing
  ctx.beginPath();
  ctx.moveTo(s * 0.35, -s * 0.1);
  ctx.quadraticCurveTo(s * 0.75, -s * 0.5, s * 0.7, 0);
  ctx.quadraticCurveTo(s * 0.55, s * 0.3, s * 0.35, s * 0.15);
  ctx.closePath();
  ctx.fill(); ctx.stroke();

  // Pearlescent Body
  const g = ctx.createLinearGradient(0, -s * 0.4, 0, s * 0.4);
  g.addColorStop(0, '#FFFFFF');
  g.addColorStop(0.5, '#F5D0FE');
  g.addColorStop(1, '#D8B4FE');
  rr(ctx, -s * 0.38, -s * 0.38, s * 0.76, s * 0.76, s * 0.22, g, '#C084FC', 3);

  // Cute closed smiling eyes
  ctx.strokeStyle = '#6B21A8';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  [-s * 0.18, s * 0.18].forEach(ex => {
    ctx.beginPath();
    ctx.arc(ex, -s * 0.04, s * 0.08, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  });

  // Rosy Cheeks
  ctx.fillStyle = 'rgba(244, 114, 182, 0.5)';
  ctx.beginPath();
  ctx.arc(-s * 0.22, s * 0.1, s * 0.06, 0, Math.PI * 2);
  ctx.arc(s * 0.22, s * 0.1, s * 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * 3D Isometric Floating Rune Pedestal (Centerpiece)
 */
function drawFloatingPedestal(ctx: SKRSContext2D, cx: number, cy: number, w = 500, h = 130): void {
  ctx.save();
  // Ambient glow beneath
  const bgGlow = ctx.createRadialGradient(cx, cy + 30, 20, cx, cy + 30, w * 0.55);
  bgGlow.addColorStop(0, 'rgba(217, 70, 239, 0.7)');
  bgGlow.addColorStop(0.5, 'rgba(147, 51, 234, 0.25)');
  bgGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = bgGlow;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 30, w * 0.55, h * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();

  // Floating Runic Outer Ring
  ctx.strokeStyle = 'rgba(244, 114, 182, 0.6)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 15, w * 0.52, h * 0.35, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Pedestal Lower Bevel (3D depth)
  const bevelH = 34;
  const polyLower: [number, number][] = [
    [cx - w * 0.42, cy],
    [cx + w * 0.42, cy],
    [cx + w * 0.38, cy + bevelH],
    [cx - w * 0.38, cy + bevelH],
  ];
  ctx.fillStyle = '#1A062E';
  ctx.beginPath();
  ctx.moveTo(polyLower[0][0], polyLower[0][1]);
  polyLower.forEach(p => ctx.lineTo(p[0], p[1]));
  ctx.closePath();
  ctx.fill();

  // Pedestal Top Surface (Glowing crystal slab)
  const topGrad = ctx.createLinearGradient(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
  topGrad.addColorStop(0, '#581C87');
  topGrad.addColorStop(0.5, '#3B0764');
  topGrad.addColorStop(1, '#24083D');
  ctx.fillStyle = topGrad;
  ctx.strokeStyle = '#F0ABFC';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(cx, cy, w * 0.42, h * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Inner Rune Circle
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(cx, cy, w * 0.28, h * 0.16, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Flanking Procedural Crystal Clusters
  drawProceduralCrystal(ctx, cx - w * 0.4, cy - 10, 48, '#E879F9', '#38BDF8');
  drawProceduralCrystal(ctx, cx - w * 0.35, cy + 10, 32, '#F472B6', '#C084FC');
  drawProceduralCrystal(ctx, cx + w * 0.4, cy - 10, 48, '#38BDF8', '#E879F9');
  drawProceduralCrystal(ctx, cx + w * 0.35, cy + 10, 32, '#C084FC', '#F472B6');
  ctx.restore();
}

// ============================================================================
// AVATAR FETCHING
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
    const res = await fetch(u, { signal: AbortSignal.timeout(10_000) });
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
        signal: AbortSignal.timeout(10_000),
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
// STAGE & UI PANELS
// ============================================================================

function drawStage(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, avatar: Image | null, rank: number | null): void {
  const cx = x + w / 2;
  const cy = y + h / 2 + 10;

  // 1. Procedural 3D Pedestal
  drawFloatingPedestal(ctx, cx, cy + 50, 480, 130);

  // 2. Avatar on Platform
  if (avatar) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 10;
    const avS = 250;
    const dw = Math.min(avS, avS * (avatar.width / avatar.height));
    const dh = avS;
    ctx.drawImage(avatar, cx - dw / 2, cy - 145, dw, dh);
    ctx.restore();
  } else {
    drawVectorCrown(ctx, cx, cy - 40, 90, '#FBBF24', '#B45309');
  }

  // 3. Companion Block Pets flanking the player
  drawPetCat(ctx, cx - 180, cy + 25, 115);
  drawPetBat(ctx, cx + 180, cy + 25, 115);
  drawPetAngel(ctx, cx + 185, cy - 110, 95);

  // 4. Stage Status Badge
  rr(ctx, cx - 85, cy + 96, 170, 36, 18, '#3B0764', '#F472B6', 2);
  drawVectorCrown(ctx, cx - 55, cy + 114, 16, '#FBBF24', '#D97706');
  caps(ctx, rank ? `RANK #${rank}` : 'TOP ROSTER', cx + 14, cy + 118, 10, '#FFFFFF', 'center', 1.6);
}

function drawPlayerCardPanel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, title: string, tag: string, rank: number | null, consistency: number | null, avatar: Image | null): void {
  drawCartoonCard(ctx, x, y, w, h);

  // Circular Mini Avatar Thumbnail
  const avR = 38, avCx = x + 54, avCy = y + h / 2 - 8;
  ctx.save();
  ctx.beginPath();
  ctx.arc(avCx, avCy, avR + 3, 0, Math.PI * 2);
  ctx.fillStyle = C.panelGlow;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(avCx, avCy, avR, 0, Math.PI * 2);
  ctx.fillStyle = '#170627';
  ctx.fill();
  ctx.clip();
  if (avatar) {
    const f = Math.max((avR * 2) / avatar.width, (avR * 2) / avatar.height);
    ctx.drawImage(avatar, avCx - (avatar.width * f) / 2, avCy - (avatar.height * f) / 2, avatar.width * f, avatar.height * f);
  } else {
    drawVectorStar(ctx, avCx, avCy, 18, '#FFF', '#A855F7', 2);
  }
  ctx.restore();

  rr(ctx, avCx - 24, avCy + avR - 10, 48, 20, 10, '#581C87', '#F0ABFC', 2);
  txt(ctx, rank ? `#${rank}` : '#1', avCx, avCy + avR + 5, 12, '#FFFFFF', true, 'center');

  const tx = x + 112;
  const cleanName = title || 'Player';
  txt(ctx, cleanName, tx, y + 54, fitText(ctx, cleanName, w - 130, 26), '#FFFFFF', true);
  caps(ctx, `@${cleanName.toLowerCase().replace(/\s+/g, '')} • [${tag || 'R3V0'}]`, tx, y + 78, 11, '#D8B4FE', 'left', 1.4);

  // Session Tempo Progress Bar
  const actVal = Math.max(0.1, Math.min(1, consistency ?? 0.85));
  const barW = w - 135, barY = y + 112;
  caps(ctx, 'SESSION TEMPO', tx, barY - 6, 9, C.textDim, 'left', 1.8);
  caps(ctx, `${Math.round(actVal * 100)}% ACTIVE`, tx + barW, barY - 6, 9, C.accentPink, 'right', 1.2);
  rr(ctx, tx, barY, barW, 10, 5, 'rgba(40, 12, 60, 0.9)');
  const barGrad = ctx.createLinearGradient(tx, 0, tx + barW, 0);
  barGrad.addColorStop(0, '#A855F7');
  barGrad.addColorStop(1, '#F472B6');
  rr(ctx, tx, barY, barW * actVal, 10, 5, barGrad);
}

function drawCurrentStarsPanel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, current: number | null): void {
  drawCartoonCard(ctx, x, y, w, h);
  drawVectorStar(ctx, x + 34, y + 36, 12, '#FFFFFF', C.panelGlow, 2);
  caps(ctx, 'CURRENT STARS', x + 56, y + 42, 14, '#FFFFFF', 'left', 2.0);

  drawVectorStar(ctx, x + 66, y + 116, 36, '#F5D0FE', '#9333EA', 4);
  const valStr = current === null ? '—' : fmt(current);
  txt(ctx, valStr, x + 128, y + 126, fitText(ctx, valStr, w - 150, 58), '#FFFFFF', true);
  caps(ctx, current === null ? '0 STARS VERIFIED' : `${fmtExact(current)} EXACT STARS`, x + 130, y + 152, 9, '#C4B5FD', 'left', 1.4);
}

function drawClanPositionPanel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, rank: number | null, members: number | null, lead: number | null): void {
  drawCartoonCard(ctx, x, y, w, h);
  drawVectorCrown(ctx, x + 36, y + 34, 20, '#FFFFFF', C.panelGlow);
  caps(ctx, 'CLAN POSITION', x + 58, y + 42, 14, '#FFFFFF', 'left', 2.0);

  // Rank emblem
  const rCx = x + 76, rCy = y + 114;
  ctx.strokeStyle = '#F0ABFC';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(rCx, rCy, 40, 0, Math.PI * 2);
  ctx.stroke();
  txt(ctx, rank ? `#${rank}` : '#1', rCx, rCy + 16, 44, '#FFFFFF', true, 'center');

  const bx = x + 145;
  rr(ctx, bx, y + 66, w - 165, 40, 12, 'rgba(88, 28, 135, 0.7)', 'rgba(216, 180, 254, 0.4)', 1.5);
  caps(ctx, 'ELITE WAR SQUAD', bx + 16, y + 84, 10, '#FFFFFF', 'left', 1.6);
  caps(ctx, members ? `ROSTER: ${members} PLAYERS` : 'TOP 1% ACTIVE', bx + 16, y + 98, 8, '#D8B4FE', 'left', 1.2);

  caps(ctx, 'LEAD TO BEHIND', bx, y + 132, 9, C.textDim, 'left', 1.6);
  txt(ctx, lead !== null ? `+${fmt(lead)} pts` : '+49.7m pts', bx, y + 156, 21, C.accentPink, true);
}

function drawContributionPanel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, userPoints: number | null, clanTotal: number | null, share: number | null): void {
  drawCartoonCard(ctx, x, y, w, h);
  drawVectorStar(ctx, x + 34, y + 36, 11, '#FFFFFF', C.accentCyan, 2);
  caps(ctx, 'CLAN SHARE', x + 56, y + 42, 14, '#FFFFFF', 'left', 2.0);

  // Donut Gauge
  const pct = Math.max(0, Math.min(100, share ?? 14));
  const cx = x + 66, cy = y + 116, rad = 34;
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(56, 18, 82, 0.85)';
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.stroke();

  if (pct > 0) {
    const g = ctx.createLinearGradient(cx - rad, cy, cx + rad, cy);
    g.addColorStop(0, '#D946EF');
    g.addColorStop(1, '#38BDF8');
    ctx.strokeStyle = g;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * pct) / 100);
    ctx.stroke();
  }
  txt(ctx, `${Math.round(pct)}%`, cx, cy + 7, 18, '#FFFFFF', true, 'center');

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

function drawContributionHistoryChart(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, series: Series): void {
  drawCartoonCard(ctx, x, y, w, h);
  drawVectorCrown(ctx, x + 36, y + 34, 18, '#FFFFFF', '#A855F7');
  caps(ctx, 'CONTRIBUTION TIMELINE', x + 58, y + 40, 15, '#FFFFFF', 'left', 1.8);

  const px = x + 72, py = y + 74, pw = w - 105, ph = h - 130, bottom = py + ph;
  const validVals = series.values.filter((v): v is number => v !== null && v > 0);
  const max = validVals.length ? Math.max(...validVals) : 0;
  const yMax = max > 0 ? max * 1.15 : 100;

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
    g.addColorStop(0.25, '#F472B6');
    g.addColorStop(0.7, '#A855F7');
    g.addColorStop(1, '#3B0764');

    ctx.save();
    if (value > 0) {
      ctx.shadowColor = C.panelGlow;
      ctx.shadowBlur = 10;
    }
    rr(ctx, bx, by, barW, bh, Math.min(6, barW / 2), g, value > 0 ? '#FFFFFF' : 'rgba(216, 180, 254, 0.2)', 1.2);
    ctx.restore();
  });

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

  const hours = (series.end - series.start) / 3_600_000;
  const ticks = hours <= 6 ? 6 : 8;
  for (let i = 0; i <= ticks; i++) {
    const ago = hours * (1 - i / ticks);
    const label = i === ticks ? 'NOW' : ago >= 1 ? `-${Math.round(ago)}h` : `-${Math.round(ago * 60)}m`;
    txt(ctx, label, px + (pw * i) / ticks, bottom + 24, 11, i === ticks ? '#F472B6' : C.textDim, false, 'center');
  }
}

function drawPerformancePanel(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, gain: number | null, average: number | null, best: number | null, pace: number | null): void {
  drawCartoonCard(ctx, x, y, w, h);
  drawVectorCrown(ctx, x + 34, y + 34, 18, '#FFFFFF', C.accentCyan);
  caps(ctx, 'PERFORMANCE STATS', x + 56, y + 40, 15, '#FFFFFF', 'left', 1.8);

  rr(ctx, x + w - 135, y + 24, 110, 26, 13, 'rgba(88, 28, 135, 0.75)', '#D8B4FE', 1);
  caps(ctx, 'TELEMETRY LIVE', x + w - 80, y + 41, 9, '#F5D0FE', 'center', 1.0);

  const rows = [
    { label: 'Total Stars Farmed', val: gain === null ? '—' : fmt(gain), tag: 'ACTIVE' },
    { label: 'Average Hourly Pace', val: average === null ? '—' : `${fmt(average)}/h`, tag: 'STABLE' },
    { label: 'Best Peak Spike', val: best === null ? '—' : fmt(best), tag: 'PEAK' },
    { label: 'Current Tempo Pace', val: pace === null ? '—' : `${fmt(pace)}/h`, tag: 'LIVE' },
  ];

  rows.forEach((r, i) => {
    const ry = y + 74 + i * 56;
    rr(ctx, x + 18, ry - 14, w - 36, 48, 12, 'rgba(255, 255, 255, 0.04)', 'rgba(216, 180, 254, 0.15)', 1);
    drawVectorStar(ctx, x + 36, ry + 10, 6, '#F5D0FE', '#A855F7', 1.5);
    caps(ctx, r.label, x + 52, ry + 14, 11, C.textMuted, 'left', 1.2);
    txt(ctx, r.val, x + w - 105, ry + 16, 19, '#FFFFFF', true, 'right');
    rr(ctx, x + w - 88, ry - 2, 70, 22, 11, 'rgba(88, 28, 135, 0.85)', '#F472B6', 1);
    caps(ctx, r.tag, x + w - 53, ry + 13, 9, '#FFFFFF', 'center', 1.2);
  });
}

// ============================================================================
// PROCEDURAL BACKGROUND (NO LOCAL PNG REQUIRED)
// ============================================================================

function drawProceduralSpaceBackground(ctx: SKRSContext2D, w: number, h: number): void {
  // Deep space base
  const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
  bgGrad.addColorStop(0, '#0E0220');
  bgGrad.addColorStop(0.5, '#070110');
  bgGrad.addColorStop(1, '#030008');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  // Vibrant cosmic nebulas
  const n1 = ctx.createRadialGradient(w * 0.2, h * 0.3, 50, w * 0.2, h * 0.3, 500);
  n1.addColorStop(0, 'rgba(147, 51, 234, 0.22)');
  n1.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = n1;
  ctx.fillRect(0, 0, w, h);

  const n2 = ctx.createRadialGradient(w * 0.8, h * 0.4, 50, w * 0.8, h * 0.4, 600);
  n2.addColorStop(0, 'rgba(217, 70, 239, 0.2)');
  n2.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = n2;
  ctx.fillRect(0, 0, w, h);

  // Twinkling stars
  const starCoords = [
    [100, 80, 2], [240, 150, 1.5], [420, 70, 3], [750, 110, 2], [920, 60, 2.5],
    [1200, 90, 1.8], [1450, 130, 3], [1520, 240, 1.5], [80, 450, 2], [1500, 520, 2.2],
    [120, 780, 2.5], [1480, 820, 2], [800, 950, 1.8], [600, 50, 2], [1350, 40, 2.5]
  ];
  starCoords.forEach(([sx, sy, sr]) => {
    ctx.fillStyle = '#FFFFFF';
    ctx.shadowColor = '#F472B6';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.shadowBlur = 0;

  // Dark edge vignette
  const vignette = ctx.createRadialGradient(w / 2, h / 2, 300, w / 2, h / 2, Math.max(w, h) * 0.72);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(3, 0, 8, 0.85)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
}

// ============================================================================
// MAIN RENDER EXPORTS
// ============================================================================

function eventMeta(subtitle: string, heading?: readonly [string, string]): { tag: string; event: string } {
  const parts = (subtitle ?? '').split(/[•|]/).map(s => s.trim()).filter(Boolean);
  const tag = (parts[0] ?? '').replace(/[\[\]]/g, '').slice(0, 24);
  const event = heading?.join(' ') ?? (parts.slice(1).join(' · ') || 'PET SIMULATOR 99 CLAN BATTLE');
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

  registerOptionalFonts(options.assetDirectory);

  const avatar = await playerImage(validId(userId) ?? idFromAvatarUrl(avatarUrl), avatarUrl, options.avatarRenderUrl);

  // 1. Procedural Background
  drawProceduralSpaceBackground(ctx, w, h);

  // 2. Header
  // Procedural Logo Badge
  rr(ctx, 40, 22, 90, 80, 18, '#3B0764', '#D946EF', 2.5);
  drawVectorCrown(ctx, 85, 58, 38, '#FBBF24', '#B45309');
  txt(ctx, 'R3V0', 145, 64, 48, '#FFFFFF', true);
  caps(ctx, 'CLAN TELEMETRY & WAR ROOM', 147, 90, 12, C.accentPink, 'left', 2.5);

  const meta = eventMeta(subtitle, options.heading);
  rr(ctx, w - 280, 36, 115, 34, 17, 'rgba(88, 28, 135, 0.85)', '#D946EF', 1.5);
  caps(ctx, `${selectedTimeframe.toUpperCase()} WINDOW`, w - 222, 58, 10, '#FFFFFF', 'center', 1.4);

  rr(ctx, w - 150, 36, 115, 34, 17, 'rgba(4, 78, 72, 0.85)', '#2DD4BF', 1.5);
  caps(ctx, '● LIVE DATA', w - 92, 58, 10, '#99F6E4', 'center', 1.6);

  caps(ctx, meta.event, w - 40, 94, 11, '#E9D5FF', 'right', 1.6);
  caps(ctx, meta.tag ? `CLAN [${meta.tag}]` : '[R3V0 CLAN]', w - 40, 112, 9, C.textDim, 'right', 1.4);

  // 3. Stats calculation
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

  // 4. Middle Stage & Side Cards (Symmetrical Grid: 420px | 640px | 420px)
  drawPlayerCardPanel(ctx, 40, 125, 420, 205, title, meta.tag, rank, consistency, avatar);
  drawCurrentStarsPanel(ctx, 40, 350, 420, 205, current);

  drawStage(ctx, 480, 125, 640, 430, avatar, rank);

  drawClanPositionPanel(ctx, 1140, 125, 420, 205, rank, members, lead);
  drawContributionPanel(ctx, 1140, 350, 420, 205, userPoints, clanTotal, share);

  // 5. Bottom Section
  drawContributionHistoryChart(ctx, 40, 575, 1040, 370, series);
  drawPerformancePanel(ctx, 1100, 575, 460, 370, gain, average, best, pace);

  // 6. Footer
  caps(ctx, 'R3V0 INTELLIGENCE • PURE VECTOR GRAPHICS ENGINE', 45, 980, 9, C.textDim, 'left', 1.8);
  caps(ctx, 'PET SIMULATOR 99 • ULTRA-HD 4K RENDER', w - 45, 980, 9, C.textDim, 'right', 1.8);

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

  registerOptionalFonts(options.assetDirectory);
  const avatar = await playerImage(validId(userId) ?? idFromAvatarUrl(avatarUrl), avatarUrl, options.avatarRenderUrl);
  const meta = eventMeta(subtitle, options.heading);

  drawProceduralSpaceBackground(ctx, w, h);

  // Logo
  rr(ctx, w / 2 - 40, 24, 80, 70, 16, '#3B0764', '#D946EF', 2);
  drawVectorCrown(ctx, w / 2, 54, 34, '#FBBF24', '#B45309');

  // Main Card
  drawCartoonCard(ctx, 35, 115, 570, 700, 24);

  // Pedestal & Avatar
  drawFloatingPedestal(ctx, w / 2, 380, 380, 110);
  drawPetCat(ctx, 95, 340, 100);
  drawPetBat(ctx, w - 95, 340, 100);
  drawPetAngel(ctx, w - 100, 190, 85);

  if (avatar) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 10;
    const avS = 220;
    const dw = Math.min(avS, avS * (avatar.width / avatar.height));
    ctx.drawImage(avatar, w / 2 - dw / 2, 205, dw, avS);
    ctx.restore();
  }

  const pName = title || 'Player';
  txt(ctx, pName, w / 2, 530, fitText(ctx, pName, 480, 38), '#FFFFFF', true, 'center');
  caps(ctx, meta.tag ? `[${meta.tag}] CLAN ROSTER` : '[R3V0] SQUAD', w / 2, 560, 12, '#D8B4FE', 'center', 1.6);

  rr(ctx, w / 2 - 90, 590, 180, 40, 20, '#581C87', '#D946EF', 2);
  caps(ctx, options.rank ? `WAR RANK #${options.rank}` : 'MEMBER', w / 2, 615, 11, '#FFFFFF', 'center', 1.6);

  if (options.roleLabel) {
    rr(ctx, 65, 655, 510, 55, 16, 'rgba(15, 6, 26, 0.9)', '#A855F7', 1.5);
    caps(ctx, 'ASSIGNED ROLE', w / 2, 678, 9, C.textDim, 'center', 1.8);
    txt(ctx, options.roleLabel, w / 2, 698, 19, '#5EEAD4', true, 'center');
  }

  caps(ctx, 'R3V0 CLAN INTELLIGENCE', w / 2, 840, 10, C.textDim, 'center', 2.0);
  return canvas.encode('png');
}

export async function renderRap(r: RapResult): Promise<Buffer> {
  const w = 1200, h = 680, scale = 2;
  const canvas = createCanvas(w * scale, h * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  registerOptionalFonts();
  drawProceduralSpaceBackground(ctx, w, h);

  // Header
  rr(ctx, 40, 20, 90, 75, 16, '#3B0764', '#D946EF', 2);
  drawVectorCrown(ctx, 85, 54, 34, '#FBBF24', '#B45309');
  txt(ctx, 'RAP TRACKER', 150, 60, 36, '#FFFFFF', true);
  caps(ctx, 'PET VALUATION & MARKET INTELLIGENCE', 152, 84, 10, C.textMuted, 'left', 2.0);

  // Left Item Preview Card
  drawCartoonCard(ctx, 40, 115, 350, 525, 24);
  const img = await loadRemote(r.imageUrl);
  if (img) {
    const f = Math.min(260 / img.width, 240 / img.height);
    const dw = img.width * f, dh = img.height * f;
    ctx.drawImage(img, 40 + (350 - dw) / 2, 160 + (240 - dh) / 2, dw, dh);
  } else {
    drawPetCat(ctx, 215, 280, 160);
  }

  txt(ctx, r.name, 215, 470, fitText(ctx, r.name, 310, 28), '#FFFFFF', true, 'center');
  caps(ctx, 'TARGET ITEM', 215, 498, 9, C.textDim, 'center', 1.8);

  // Right Variants Card
  drawCartoonCard(ctx, 410, 115, 750, 525, 24);
  txt(ctx, 'MARKET VARIANTS', 445, 162, 24, '#FFFFFF', true);

  caps(ctx, 'VARIANT TYPE', 450, 198, 9, C.textDim, 'left', 1.8);
  caps(ctx, 'DIAMONDS (RAP)', 870, 198, 9, C.textDim, 'right', 1.8);
  caps(ctx, '24H DELTA', 1115, 198, 9, C.textDim, 'right', 1.8);

  const vars = Array.isArray(r.variants) ? r.variants.slice(0, 5) : [];
  vars.forEach((v, i) => {
    const yy = 214 + i * 72;
    rr(ctx, 440, yy, 690, 58, 16, 'rgba(15, 6, 26, 0.9)', 'rgba(216, 180, 254, 0.25)', 1.2);
    txt(ctx, v.label, 460, yy + 36, 21, '#FFFFFF', true);
    txt(ctx, num(v.value) === null ? '—' : fmt(v.value), 870, yy + 36, 23, '#FFF', true, 'right');

    const d = typeof v.delta === 'number' && Number.isFinite(v.delta) ? v.delta : null;
    const p = typeof v.deltaPct === 'number' && Number.isFinite(v.deltaPct) ? v.deltaPct : null;
    const isUp = (d ?? 0) >= 0;
    const str = d === null ? '—' : `${isUp ? '+' : ''}${fmt(d)}${p === null ? '' : ` (${isUp ? '+' : ''}${p.toFixed(1)}%)`}`;
    txt(ctx, str, 1110, yy + 36, 18, d === null ? C.textDim : isUp ? C.accentGreen : C.accentPink, true, 'right');
  });

  caps(ctx, `BASELINE: ${r.baselineLabel ?? 'NORMAL'}`, 445, 605, 9, C.textDim, 'left', 1.8);
  return canvas.encode('png');
}
