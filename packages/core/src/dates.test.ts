import { describe, expect, it } from 'vitest';
import {
  addDays,
  dateRange,
  daysBetween,
  formatMinutes,
  isoWeekKey,
  isoWeekday,
  isWeekend,
  lastDayOfMonth,
  parseTimeToMinutes,
  startOfISOWeek,
} from './dates.js';

describe('date helpers', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('handles leap years', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(lastDayOfMonth(2028, 2)).toBe('2028-02-29');
    expect(lastDayOfMonth(2026, 2)).toBe('2026-02-28');
  });

  it('produces inclusive date ranges', () => {
    expect(dateRange('2026-09-01', '2026-09-03')).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
    ]);
    expect(dateRange('2026-09-01', '2026-09-30')).toHaveLength(30);
    expect(daysBetween('2026-09-01', '2026-09-30')).toBe(29);
  });

  it('numbers weekdays the ISO way', () => {
    expect(isoWeekday('2026-08-31')).toBe(1); // Monday
    expect(isoWeekday('2026-09-06')).toBe(7); // Sunday
    expect(isWeekend('2026-09-05')).toBe(true);
    expect(isWeekend('2026-09-04')).toBe(false);
    expect(startOfISOWeek('2026-09-06')).toBe('2026-08-31');
  });

  it('groups a whole week under one key', () => {
    const keys = dateRange('2026-08-31', '2026-09-06').map(isoWeekKey);
    expect(new Set(keys).size).toBe(1);
    expect(isoWeekKey('2026-09-07')).not.toBe(isoWeekKey('2026-09-06'));
  });

  it('parses and formats shift times', () => {
    expect(parseTimeToMinutes('06:00')).toBe(360);
    expect(parseTimeToMinutes('02:00 PM')).toBe(840);
    expect(parseTimeToMinutes('12:00 AM')).toBe(0);
    expect(parseTimeToMinutes('12:00 PM')).toBe(720);
    expect(formatMinutes(360)).toBe('06:00 AM');
    expect(formatMinutes(840)).toBe('02:00 PM');
    expect(formatMinutes(1320)).toBe('10:00 PM');
  });
});
