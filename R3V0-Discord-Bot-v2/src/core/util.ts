import { randomInt } from 'node:crypto';
import { DateTime } from 'luxon';

export class UserError extends Error {}
export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  let out = s.slice(0, max - 1);
  if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
  return out + '…';
}
export function safeText(s: string, max = 1000): string {
  return clip(s.replace(/`/g, 'ˋ').replace(/\u0000/g, ''), max) || 'None';
}
export function errorCode(err: unknown): number | string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? (err as { code: number | string }).code : undefined;
}
export function errorText(err: unknown): string {
  let message = err instanceof Error ? err.message : String(err);
  const token = process.env.DISCORD_TOKEN;
  if (token) message = message.split(token).join('[REDACTED]');
  return clip(message, 1500);
}
const units: Record<string, number> = {
  s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
  m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000,
  h: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000,
  d: 86_400_000, day: 86_400_000, days: 86_400_000,
  w: 604_800_000, week: 604_800_000, weeks: 604_800_000
};
export function parseDuration(input: string, maximum = 365 * 86_400_000): number {
  const s = input.trim().toLowerCase();
  if (!s || s.length > 100) throw new UserError('Enter a duration such as 1s, 10s, 1m, 1 minute or 1h 30m.');
  let total = 0, cursor = 0, parts = 0;
  const re = /(\d+(?:\.\d+)?)\s*([a-z]+)/g;
  for (const match of s.matchAll(re)) {
    if (s.slice(cursor, match.index).trim()) throw new UserError('Invalid duration. Use 1s, 10s, 1m, 1 minute or 1h 30m.');
    const multiplier = units[match[2]];
    if (!multiplier) throw new UserError('Supported units: seconds, minutes, hours, days and weeks.');
    total += Number(match[1]) * multiplier;
    cursor = match.index! + match[0].length;
    parts++;
  }
  if (!parts || s.slice(cursor).trim() || !Number.isSafeInteger(total) || total < 1000 || total > maximum) {
    throw new UserError(`Duration must be between 1 second and ${humanDuration(maximum)}.`);
  }
  return total;
}
export function humanDuration(ms: number): string {
  let seconds = Math.max(0, Math.floor(ms / 1000));
  const values: string[] = [];
  for (const [amount, name] of [[86400, 'day'], [3600, 'hour'], [60, 'minute'], [1, 'second']] as const) {
    const n = Math.floor(seconds / amount);
    if (n) { values.push(`${n} ${name}${n === 1 ? '' : 's'}`); seconds %= amount; }
    if (values.length === 2) break;
  }
  return values.join(' ') || '0 seconds';
}
export type Period = 'daily' | 'weekly' | 'monthly' | 'all';
export function periodStart(period: Period, timezone: string, now = Date.now()): number {
  const dt = DateTime.fromMillis(now, { zone: timezone });
  if (!dt.isValid) throw new Error('Invalid timezone');
  switch (period) {
    case 'daily': return dt.startOf('day').toMillis();
    case 'weekly': return dt.startOf('week').toMillis();
    case 'monthly': return dt.startOf('month').toMillis();
    case 'all': return 0;
  }
}
export const stamp = (ms: number, style = 'F') => `<t:${Math.floor(ms / 1000)}:${style}>`;
export function shuffle<T>(items: readonly T[], choose: (max: number) => number = randomInt): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const j = choose(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
export class Mutex {
  private readonly tails = new Map<string, Promise<void>>();
  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    this.tails.set(key, current);
    await previous;
    try { return await work(); }
    finally { release(); if (this.tails.get(key) === current) this.tails.delete(key); }
  }
}
export function nicknameWithSuffix(base: string, suffix: string): string {
  const escaped = suffix.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let clean = base.replace(new RegExp(`(?:\\s*${escaped})+$`, 'i'), '').trim() || 'Member';
  const limit = 32 - suffix.length;
  let fitted = '';
  for (const ch of clean) { if (fitted.length + ch.length > limit) break; fitted += ch; }
  clean = fitted.trimEnd();
  return clean + suffix;
}
