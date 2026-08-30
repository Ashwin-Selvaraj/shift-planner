import { describe, expect, it } from 'vitest';
import { dateRange, isoWeekKey } from './dates.js';
import { DEFAULT_POLICY } from './policy.js';
import { generateRoster, suggestReplacements } from './roster-engine.js';
import { DEFAULT_SHIFTS, makeEmployee, makeWorkforce } from './test-fixtures.js';
import { workStreaks, indexAssignments } from './shift-rules.js';
import type { AssignmentRecord, HolidayRecord, LeaveRecord } from './types.js';

const MONTH = { startDate: '2026-09-01', endDate: '2026-09-30' };
const [S1, , S3] = DEFAULT_SHIFTS as [
  (typeof DEFAULT_SHIFTS)[number],
  (typeof DEFAULT_SHIFTS)[number],
  (typeof DEFAULT_SHIFTS)[number],
];

describe('auto-roster engine (BRD 24)', () => {
  const employees = makeWorkforce(40);

  it('produces a publishable roster for a well-staffed team', () => {
    const result = generateRoster({ ...MONTH, employees, shifts: DEFAULT_SHIFTS });
    expect(result.gaps).toHaveLength(0);
    expect(result.validation.criticalCount).toBe(0);
    expect(result.validation.canPublish).toBe(true);
  });

  it('assigns exactly one entry per employee per day (BRD 15)', () => {
    const result = generateRoster({ ...MONTH, employees, shifts: DEFAULT_SHIFTS });
    const seen = new Set<string>();
    for (const a of result.assignments) {
      const key = `${a.employeeId}|${a.date}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(result.assignments).toHaveLength(employees.length * 30);
  });

  it('never creates a seven day streak (BRD 20)', () => {
    const result = generateRoster({ ...MONTH, employees, shifts: DEFAULT_SHIFTS });
    const byEmployee = indexAssignments(result.assignments);
    const days = dateRange(MONTH.startDate, MONTH.endDate);
    for (const employee of employees) {
      for (const streak of workStreaks(byEmployee.get(employee.id), days)) {
        expect(streak.length).toBeLessThanOrEqual(DEFAULT_POLICY.maxConsecutiveDays);
      }
    }
  });

  it('gives every employee a weekly off in every full week (BRD 19)', () => {
    const result = generateRoster({ ...MONTH, employees, shifts: DEFAULT_SHIFTS });
    const byEmployee = indexAssignments(result.assignments);
    const weeks = new Map<string, string[]>();
    for (const date of dateRange(MONTH.startDate, MONTH.endDate)) {
      const key = isoWeekKey(date);
      weeks.set(key, [...(weeks.get(key) ?? []), date]);
    }
    for (const employee of employees) {
      const byDate = byEmployee.get(employee.id);
      for (const [, weekDays] of weeks) {
        if (weekDays.length < 7) continue;
        const rest = weekDays.filter((d) => {
          const type = byDate?.get(d)?.type;
          return type === 'OFF' || type === 'HOLIDAY' || type === 'LEAVE';
        });
        expect(rest.length).toBeGreaterThanOrEqual(DEFAULT_POLICY.minWeeklyOffs);
      }
    }
  });

  it('never rosters an employee who is on approved leave (BRD 21)', () => {
    const leaves: LeaveRecord[] = [
      {
        id: 'l1',
        employeeId: employees[3]!.id,
        startDate: '2026-09-07',
        endDate: '2026-09-14',
        kind: 'PLANNED',
        status: 'APPROVED',
      },
    ];
    const result = generateRoster({ ...MONTH, employees, shifts: DEFAULT_SHIFTS, leaves });
    const onLeave = result.assignments.filter(
      (a) => a.employeeId === employees[3]!.id && a.date >= '2026-09-07' && a.date <= '2026-09-14',
    );
    expect(onLeave).toHaveLength(8);
    expect(onLeave.every((a) => a.type === 'LEAVE')).toBe(true);
  });

  it('never produces a restricted transition (BRD 17)', () => {
    const result = generateRoster({ ...MONTH, employees, shifts: DEFAULT_SHIFTS });
    expect(
      result.validation.issues.filter((i) => i.code === 'RESTRICTED_TRANSITION'),
    ).toHaveLength(0);
  });

  it('marks location holidays and keeps reduced coverage (BRD 15 and 22)', () => {
    const holidays: HolidayRecord[] = [
      { id: 'h1', locationId: 'loc-blr', date: '2026-09-15', name: 'Founders Day' },
    ];
    const result = generateRoster({ ...MONTH, employees, shifts: DEFAULT_SHIFTS, holidays });
    const onHoliday = result.assignments.filter((a) => a.date === '2026-09-15');
    expect(onHoliday.some((a) => a.type === 'HOLIDAY')).toBe(true);
    expect(onHoliday.some((a) => a.type === 'SHIFT')).toBe(true);
    expect(result.gaps.filter((g) => g.date === '2026-09-15')).toHaveLength(0);
  });

  it('preserves locked manual assignments', () => {
    const locked: AssignmentRecord[] = [
      {
        employeeId: employees[0]!.id,
        date: '2026-09-10',
        type: 'SHIFT',
        shiftId: S3.id,
        locked: true,
      },
    ];
    const result = generateRoster({
      ...MONTH,
      employees,
      shifts: DEFAULT_SHIFTS,
      existingAssignments: locked,
    });
    const kept = result.assignments.find(
      (a) => a.employeeId === employees[0]!.id && a.date === '2026-09-10',
    );
    expect(kept?.shiftId).toBe(S3.id);
  });

  it('is deterministic — the same inputs give the same roster', () => {
    const a = generateRoster({ ...MONTH, employees, shifts: DEFAULT_SHIFTS });
    const b = generateRoster({ ...MONTH, employees, shifts: DEFAULT_SHIFTS });
    expect(a.assignments).toEqual(b.assignments);
  });

  it('reports coverage gaps instead of breaking rules when understaffed', () => {
    const skeleton = makeWorkforce(6);
    const result = generateRoster({ ...MONTH, employees: skeleton, shifts: DEFAULT_SHIFTS });
    expect(result.gaps.length).toBeGreaterThan(0);
    expect(result.validation.canPublish).toBe(false);
    // Even under pressure the hard rules hold.
    expect(
      result.validation.issues.filter(
        (i) => i.code === 'SEVEN_DAY_STREAK' || i.code === 'RESTRICTED_TRANSITION',
      ),
    ).toHaveLength(0);
  });

  it('generates a 10,000 employee roster within the 60 second budget (BRD 32)', () => {
    const large = makeWorkforce(10_000);
    const shifts = DEFAULT_SHIFTS.map((s) => ({ ...s, minStaff: 100, maxStaff: 200 }));
    const result = generateRoster({ ...MONTH, employees: large, shifts });
    expect(result.stats.durationMs).toBeLessThan(60_000);
    expect(result.validation.canPublish).toBe(true);
  }, 120_000);
});

describe('replacement suggestions (BRD 13 and 21)', () => {
  it('ranks a rested same-role colleague above a fatigued one', () => {
    const absent = makeEmployee('absent', { role: 'SHIFT_LEAD', isCoreResource: true });
    const rested = makeEmployee('rested', { role: 'SHIFT_LEAD', isCoreResource: true });
    const tired = makeEmployee('tired', { role: 'TEAM_MEMBER' });

    const assignments: AssignmentRecord[] = [
      { employeeId: 'absent', date: '2026-09-10', type: 'SHIFT', shiftId: S1.id },
      { employeeId: 'rested', date: '2026-09-10', type: 'OFF' },
      { employeeId: 'tired', date: '2026-09-10', type: 'OFF' },
      ...dateRange('2026-09-06', '2026-09-09').map(
        (date): AssignmentRecord => ({ employeeId: 'tired', date, type: 'SHIFT', shiftId: S1.id }),
      ),
    ];

    const suggestions = suggestReplacements({
      date: '2026-09-10',
      shift: S1,
      absentEmployee: absent,
      employees: [absent, rested, tired],
      shifts: DEFAULT_SHIFTS,
      assignments,
    });

    expect(suggestions[0]?.employee.id).toBe('rested');
    expect(suggestions[0]?.reasons.length).toBeGreaterThan(0);
  });

  it('excludes anyone already working or on leave that day', () => {
    const absent = makeEmployee('absent');
    const busy = makeEmployee('busy');
    const away = makeEmployee('away');
    const suggestions = suggestReplacements({
      date: '2026-09-10',
      shift: S1,
      absentEmployee: absent,
      employees: [absent, busy, away],
      shifts: DEFAULT_SHIFTS,
      assignments: [
        { employeeId: 'busy', date: '2026-09-10', type: 'SHIFT', shiftId: S1.id },
        { employeeId: 'away', date: '2026-09-10', type: 'OFF' },
      ],
      leaves: [
        {
          id: 'l1',
          employeeId: 'away',
          startDate: '2026-09-10',
          endDate: '2026-09-10',
          kind: 'EMERGENCY',
          status: 'APPROVED',
        },
      ],
    });
    expect(suggestions.map((s) => s.employee.id)).toEqual([]);
  });
});
