import { DateTime } from 'luxon';
import type { Config } from '../core/config.js';
import { stamp, UserError } from '../core/util.js';

export interface SupportAvailability {
  open: boolean; hours: string; timezone: string; nextOpenAt: number | null;
  closesAt: number | null; key: string;
}

/** Use the configured IANA zone, including DST; 10 PM is already closed. */
export function supportAvailability(settings: Config['tickets']['supportHours'], timezone: string, now = Date.now()): SupportAvailability {
  if (!settings.enabled) return { open: true, hours: '24/7', timezone, nextOpenAt: null, closesAt: null, key: 'always' };
  const local = DateTime.fromMillis(now, { zone: timezone }).setLocale('en');
  const start = local.startOf('day').set({ hour: settings.startHour });
  const end = settings.endHour === 24 ? local.startOf('day').plus({ days: 1 }) : local.startOf('day').set({ hour: settings.endHour });
  const open = now >= start.toMillis() && now < end.toMillis();
  const nextOpenAt = open ? null : (now < start.toMillis() ? start : start.plus({ days: 1 })).toMillis();
  const closesAt = open ? end.toMillis() : null;
  const hours = `${start.toFormat('h a')}–${end.toFormat('h a')}`;
  return { open, hours, timezone, nextOpenAt, closesAt,
    key: `${timezone}:${settings.startHour}:${settings.endHour}:${open ? 'open' : 'closed'}:${closesAt ?? nextOpenAt}` };
}

export function requireSupportOpen(status: SupportAvailability): void {
  if (!status.open) throw new UserError(`Support is currently closed. Opening hours: **${status.hours} (${status.timezone})** every day.\nNext opening: ${stamp(status.nextOpenAt!, 'R')}. A staff member can use /support-open for an exception.`);
}
