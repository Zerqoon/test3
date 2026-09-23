import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import type { HistoryPoint } from '../types.js';
import { T } from './theme.js';
import { compact, rr, txt } from './primitives.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface HistoryChartOptions {
  title: string;
  subtitle?: string;
  current: number;
  delta24h: number;
  deltaPct24h: number;
  points: HistoryPoint[];
  accent?: string;
}

function signedCompact(value: number): string {
  return `${value >= 0 ? '+' : '-'}${compact(Math.abs(value))}`;
}

function safePoints(points: HistoryPoint[]): HistoryPoint[] {
  return points
    .filter(point => Number.isFinite(point.ts) && Number.isFinite(point.value))
    .map(point => ({ ts: Number(point.ts), value: Math.max(0, Number(point.value)) }))
    .sort((a, b) => a.ts - b.ts);
}

function hexWithAlpha(color: string, alphaHex: string): string {
  if (color.startsWith('#') && color.length === 7) {
    return `${color}${alphaHex}`;
  }
  return color;
}

/**
 * Płynna interpolacja Catmull-Rom do Cubic Bezier (przechodzi idealnie przez każdy punkt)
 */
function buildSmoothPath(ctx: SKRSContext2D, points: Array<{ x: number; y: number }>): void {
  if (points.length <= 1) return;
  if (points.length === 2) {
    ctx.lineTo(points[1]!.x, points[1]!.y);
    return;
  }

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = i > 0 ? points[i - 1]! : points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = i < points.length - 2 ? points[i + 2]! : p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
}

function drawSmoothLine(
  ctx: SKRSContext2D,
  points: Array<{ x: number; y: number }>,
  accent: string
): void {
  if (!points.length) return;

  ctx.save();
  // Przebieg 1: Szeroka, miękka poświata neonowa
  ctx.strokeStyle = accent;
  ctx.lineWidth = 10;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = accent;
  ctx.shadowBlur = 24;
  ctx.globalAlpha = 0.38;

  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  buildSmoothPath(ctx, points);
  ctx.stroke();

  // Przebieg 2: Główny kontur
  ctx.globalAlpha = 1.0;
  ctx.lineWidth = 4;
  ctx.shadowBlur = 10;
  ctx.shadowColor = accent;

  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  buildSmoothPath(ctx, points);
  ctx.stroke();

  // Przebieg 3: Środkowy biały rdzeń świetlny
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.shadowBlur = 4;

  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  buildSmoothPath(ctx, points);
  ctx.stroke();

  ctx.restore();
}

function drawArea(
  ctx: SKRSContext2D,
  points: Array<{ x: number; y: number }>,
  baselineY: number,
  accent: string
): void {
  if (!points.length) return;

  const minY = Math.min(...points.map(point => point.y));
  const gradient = ctx.createLinearGradient(0, minY, 0, Math.max(minY + 1, baselineY));
  gradient.addColorStop(0, hexWithAlpha(accent, '44'));
  gradient.addColorStop(0.55, hexWithAlpha(accent, '14'));
  gradient.addColorStop(1, hexWithAlpha(accent, '00'));

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, baselineY);
  ctx.lineTo(points[0]!.x, points[0]!.y);
  buildSmoothPath(ctx, points);
  ctx.lineTo(points[points.length - 1]!.x, baselineY);
  ctx.closePath();

  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();
}

export function chart(
  ctx: SKRSContext2D,
  input: HistoryPoint[],
  x: number,
  y: number,
  width: number,
  height: number,
  accent = T.green
): void {
  const points = safePoints(input);

  // Szklane tło panelu
  const bgGrad = ctx.createLinearGradient(x, y, x, y + height);
  bgGrad.addColorStop(0, '#0f1424');
  bgGrad.addColorStop(1, '#080b14');
  rr(ctx, x, y, width, height, 22, bgGrad as unknown as string, 'rgba(255, 255, 255, 0.08)');

  const plotX = x + 106;
  const plotY = y + 46;
  const plotW = width - 150;
  const plotH = height - 110;
  const bottom = plotY + plotH;

  const now = Date.now();
  const startTime = now - DAY_MS;
  const values = points.map(point => point.value);
  const maxValue = values.length ? Math.max(...values) : 0;
  const minValue = values.length ? Math.min(...values) : 0;
  const spread = Math.max(maxValue - minValue, Math.max(1, maxValue * 0.08));
  const axisMin = Math.max(0, minValue - spread * 0.15);
  const axisMax = Math.max(axisMin + 1, maxValue + spread * 0.15);
  const axisSpan = axisMax - axisMin;

  // Siatka pozioma z kapsułkami wartości osi Y
  for (let row = 0; row <= 4; row++) {
    const yy = plotY + (plotH * row) / 4;

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(plotX, yy);
    ctx.lineTo(plotX + plotW, yy);
    ctx.stroke();
    ctx.restore();

    const axisValue = axisMax - (axisSpan * row) / 4;
    rr(ctx, plotX - 86, yy - 12, 70, 24, 6, 'rgba(16, 22, 38, 0.9)', 'rgba(255, 255, 255, 0.05)');
    txt(ctx, compact(axisValue), plotX - 51, yy + 5, 13, '#8b9bb4', true, 'center');
  }

  // Siatka pionowa i etykiety osi X
  const labels = [24, 18, 12, 6, 0];
  for (let index = 0; index < labels.length; index++) {
    const xx = plotX + (plotW * index) / (labels.length - 1);
    const isNow = labels[index] === 0;

    ctx.save();
    ctx.strokeStyle = isNow ? 'rgba(16, 185, 129, 0.25)' : 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xx, plotY);
    ctx.lineTo(xx, bottom);
    ctx.stroke();
    ctx.restore();

    const label = isNow ? 'TERAZ' : `-${labels[index]}h`;
    if (isNow) {
      rr(ctx, xx - 34, bottom + 16, 68, 26, 7, 'rgba(16, 185, 129, 0.15)', accent);
      txt(ctx, label, xx, bottom + 33, 12, accent, true, 'center');
    } else {
      txt(ctx, label, xx, bottom + 33, 14, '#64748b', false, 'center');
    }
  }

  if (!points.length) {
    const zeroY = plotY + plotH / 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(plotX, zeroY);
    ctx.lineTo(plotX + plotW, zeroY);
    ctx.stroke();
    ctx.restore();
    txt(ctx, 'Brak zarejestrowanych próbek w bazie SQLite', x + width / 2, y + height / 2 + 8, 18, '#64748b', true, 'center');
    return;
  }

  const mapped = points.map(point => {
    const clampedTs = Math.max(startTime, Math.min(now, point.ts));
    return {
      x: plotX + ((clampedTs - startTime) / DAY_MS) * plotW,
      y: plotY + (1 - (point.value - axisMin) / axisSpan) * plotH,
      val: point.value
    };
  });

  if (mapped.length === 1) {
    const singleY = mapped[0]!.y;
    const horizontal = [
      { x: plotX, y: singleY },
      { x: plotX + plotW, y: singleY }
    ];
    drawArea(ctx, horizontal, bottom, accent);
    drawSmoothLine(ctx, horizontal, accent);
    txt(ctx, 'Zbieranie historii w toku – pierwszy punkt pomiarowy zarejestrowany', x + width / 2, y + height - 22, 16, '#94a3b8', true, 'center');
    return;
  }

  drawArea(ctx, mapped, bottom, accent);
  drawSmoothLine(ctx, mapped, accent);

  // Wskaźnik ostatniego pomiaru (Floating Badge)
  const last = mapped[mapped.length - 1]!;

  // Promień pionowy lasera
  ctx.save();
  const beam = ctx.createLinearGradient(0, last.y, 0, bottom);
  beam.addColorStop(0, accent);
  beam.addColorStop(1, hexWithAlpha(accent, '00'));
  ctx.strokeStyle = beam;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(last.x, last.y);
  ctx.lineTo(last.x, bottom);
  ctx.stroke();
  ctx.restore();

  // Pulsujący punkt pomiaru
  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 20;
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(last.x, last.y, 8, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(last.x, last.y, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Unosząca się plakietka z wynikiem nad punktem
  const badgeText = `${compact(last.val)} PTS`;
  const badgeW = Math.max(86, ctx.measureText(badgeText).width + 30);
  const badgeH = 28;
  const badgeX = Math.min(last.x - badgeW / 2, width - badgeW - 20);
  const badgeY = Math.max(plotY + 5, last.y - badgeH - 12);

  rr(ctx, badgeX, badgeY, badgeW, badgeH, 8, '#131b2e', accent);
  txt(ctx, badgeText, badgeX + badgeW / 2, badgeY + 18, 12, '#ffffff', true, 'center');
}

export async function render24hChart(options: HistoryChartOptions): Promise<Buffer> {
  const width = 1200;
  const height = 620;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const accent = options.accent ?? T.green;

  ctx.fillStyle = '#080a14';
  ctx.fillRect(0, 0, width, height);

  // Górna laserowa linia gradientowa
  const headerGradient = ctx.createLinearGradient(48, 0, width - 48, 0);
  headerGradient.addColorStop(0, T.purple);
  headerGradient.addColorStop(0.55, T.cyan);
  headerGradient.addColorStop(1, T.yellow);
  ctx.fillStyle = headerGradient;
  ctx.fillRect(48, 30, width - 96, 5);

  txt(ctx, options.title, 56, 88, 32, '#ffffff', true);
  if (options.subtitle) {
    txt(ctx, options.subtitle, 56, 120, 16, '#8b9bb4');
  }

  txt(ctx, 'AKTUALNE PUNKTY', 56, 166, 13, '#64748b', true);
  txt(ctx, compact(options.current), 56, 210, 36, '#ffffff', true);

  const deltaText = `${signedCompact(options.delta24h)} (${options.deltaPct24h >= 0 ? '+' : ''}${options.deltaPct24h.toFixed(1)}%) w 24h`;
  const badgeWidth = Math.max(250, ctx.measureText(deltaText).width + 44);
  const isPositive = options.delta24h >= 0;

  rr(
    ctx,
    width - badgeWidth - 48,
    155,
    badgeWidth,
    56,
    14,
    isPositive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
    isPositive ? T.green : T.red
  );
  txt(ctx, deltaText, width - 70, 189, 16, isPositive ? T.green : T.red, true, 'right');

  chart(ctx, options.points, 48, 240, width - 96, 320, accent);
  txt(ctx, 'R3V0 • SQLite Database • 24h Time Series', 56, 595, 13, '#475569');

  return canvas.encode('png');
}
