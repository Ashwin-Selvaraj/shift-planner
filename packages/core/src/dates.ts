/**
 * Calendar helpers.
 *
 * Every date in the system is an ISO `YYYY-MM-DD` string and every computation
 * below runs in UTC. Rosters are planned against calendar days, not instants, so
 * keeping the whole pipeline off local time removes a whole class of
 * off-by-one-day bugs around DST and server timezone drift.
 */

const MS_PER_DAY = 86_400_000;

export function toUTC(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return toISODate(new Date(toUTC(date).getTime() + days * MS_PER_DAY));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUTC(to).getTime() - toUTC(from).getTime()) / MS_PER_DAY);
}

/** Inclusive list of ISO dates from `start` to `end`. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const total = daysBetween(start, end);
  for (let i = 0; i <= total; i += 1) out.push(addDays(start, i));
  return out;
}

/** 1 = Monday … 7 = Sunday (ISO-8601 numbering). */
export function isoWeekday(date: string): number {
  const day = toUTC(date).getUTCDay();
  return day === 0 ? 7 : day;
}

export function isWeekend(date: string): boolean {
  return isoWeekday(date) >= 6;
}

/** Monday of the ISO week containing `date`. */
export function startOfISOWeek(date: string): string {
  return addDays(date, -(isoWeekday(date) - 1));
}

/** Stable `YYYY-Www` key used to group assignments per week. */
export function isoWeekKey(date: string): string {
  const monday = toUTC(startOfISOWeek(date));
  const thursday = new Date(monday.getTime() + 3 * MS_PER_DAY);
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / (7 * MS_PER_DAY)) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function firstDayOfMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

export function lastDayOfMonth(year: number, month: number): string {
  return toISODate(new Date(Date.UTC(year, month, 0)));
}

export function monthLabel(year: number, month: number): string {
  const names = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${names[month - 1] ?? month} ${year}`;
}

export function formatMinutes(minutes: number): string {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Parses `06:00`, `6:00 AM`, `18:30` into minutes from midnight. */
export function parseTimeToMinutes(value: string): number {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) throw new Error(`Unrecognised time value: "${value}"`);
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === 'PM' && hours !== 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
}
