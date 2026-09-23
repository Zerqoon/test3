import type { SKRSContext2D } from '@napi-rs/canvas';
import { T } from './theme.js';

export function rr(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r = 18,
  fill: string = T.panel,
  stroke: string | null = T.border
): void {
  const q = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + q, y);
  ctx.lineTo(x + w - q, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + q);
  ctx.lineTo(x + w, y + h - q);
  ctx.quadraticCurveTo(x + w, y + h, x + w - q, y + h);
  ctx.lineTo(x + q, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - q);
  ctx.lineTo(x, y + q);
  ctx.quadraticCurveTo(x, y, x + q, y);
  ctx.closePath();

  ctx.fillStyle = fill;
  ctx.fill();

  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

export function txt(
  ctx: SKRSContext2D,
  s: string,
  x: number,
  y: number,
  size = 18,
  color: string = T.text,
  bold = false,
  align: CanvasTextAlign = 'left'
): void {
  // Poprawna kolejność: [weight] [size]px [family], fallback
  ctx.font = `${bold ? 'bold ' : ''}${size}px "${bold ? 'R3Bold' : 'R3'}", "Segoe UI", Arial, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
}

export function fit(
  ctx: SKRSContext2D,
  s: string,
  max: number,
  size: number,
  bold = false,
  min = 14
): number {
  let n = size;
  while (n > min) {
    ctx.font = `${bold ? 'bold ' : ''}${n}px "${bold ? 'R3Bold' : 'R3'}", "Segoe UI", Arial, sans-serif`;
    if (ctx.measureText(s).width <= max) break;
    n--;
  }
  return n;
}

export function compact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '0';
  const a = Math.abs(n);
  const units: Array<[number, string]> = [
    [1e18, 'Qi'],
    [1e15, 'Qa'],
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K']
  ];

  for (const [v, u] of units) {
    if (a >= v) {
      return `${(n / v).toFixed(a >= v * 100 ? 0 : a >= v * 10 ? 1 : 2)}${u}`;
    }
  }

  return n.toLocaleString('en-US');
}
