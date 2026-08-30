import { describe, expect, it } from 'vitest';
import { dateRange } from './dates.js';
import { DEFAULT_SHIFTS, makeEmployee } from './test-fixtures.js';
import { validateRoster, type ValidationCode } from './validation-engine.js';
import type { AssignmentRecord, EmployeeRecord, ShiftDefinition } from './types.js';

const [S1_BASE, S2, S3] = DEFAULT_SHIFTS as [
  ShiftDefinition,
  ShiftDefinition,
  ShiftDefinition,
];

/** The shift under test: two staff, one of whom must be a lead and one a core. */
const S1: ShiftDefinition = { ...S1_BASE, minStaff: 2, maxStaff: 6 };

const WEEK_START = '2026-08-31'; // Monday
const WEEK_END = '2026-09-06'; // Sunday
const SATURDAY = '2026-09-05';
const SUNDAY = '2026-09-06';

/** Only S1 is running, so the other two shifts cannot raise coverage noise. */
const S1_ONLY: ShiftDefinition[] = [S1, { ...S2, isActive: false }, { ...S3, isActive: false }];

/**
 * All three shifts live, but S2 and S3 demand nothing. Used by the transition
 * and rotation tests, which need real shifts to move between without dragging
 * in coverage errors for shifts nobody is rostered on.
 */
const ALL_SHIFTS_NO_DEMAND: ShiftDefinition[] = [
  S1,
  { ...S2, minStaff: 0, shiftLeadsRequired: 0, coreResourcesRequired: 0 },
  { ...S3, minStaff: 0, shiftLeadsRequired: 0, coreResourcesRequired: 0 },
];

/**
 * A genuinely compliant week: two leads and two core resources covering S1
 * every day, with offs staggered across the weekend so no day loses its lead or
 * its core. Each person works six days and rests one (BRD 19).
 */
function compliantWeek(): { employees: EmployeeRecord[]; assignments: AssignmentRecord[] } {
  const employees = [
    makeEmployee('l1', { role: 'SHIFT_LEAD', name: 'Lead One' }),
    makeEmployee('l2', { role: 'SHIFT_LEAD', name: 'Lead Two' }),
    makeEmployee('c1', { isCoreResource: true, name: 'Core One' }),
    makeEmployee('c2', { isCoreResource: true, name: 'Core Two' }),
  ];
  const offDay: Record<string, string> = { l1: SUNDAY, l2: SATURDAY, c1: SUNDAY, c2: SATURDAY };

  const assignments: AssignmentRecord[] = [];
  for (const employee of employees) {
    for (const date of dateRange(WEEK_START, WEEK_END)) {
      assignments.push(
        date === offDay[employee.id]
          ? { employeeId: employee.id, date, type: 'OFF' }
          : { employeeId: employee.id, date, type: 'SHIFT', shiftId: S1.id },
      );
    }
  }
  return { employees, assignments };
}

function run(
  overrides: Partial<Parameters<typeof validateRoster>[0]> = {},
): ReturnType<typeof validateRoster> {
  const base = compliantWeek();
  return validateRoster({
    startDate: WEEK_START,
    endDate: WEEK_END,
    employees: base.employees,
    shifts: S1_ONLY,
    assignments: base.assignments,
    ...overrides,
  });
}

const codes = (result: ReturnType<typeof validateRoster>): ValidationCode[] =>
  result.issues.map((i) => i.code);

describe('validation engine — the happy path', () => {
  it('passes a compliant week and permits publication', () => {
    const result = run();
    expect(result.issues.filter((i) => i.severity === 'CRITICAL')).toEqual([]);
    expect(result.canPublish).toBe(true);
  });
});

describe('critical errors block publication (BRD 25)', () => {
  it('detects a missing shift lead', () => {
    const employees = compliantWeek().employees.map((e) =>
      e.id === 'l1' ? { ...e, role: 'TEAM_MEMBER' as const } : e,
    );
    const result = run({ employees });
    const issue = result.issues.find((i) => i.code === 'MISSING_SHIFT_LEAD');
    expect(issue?.date).toBe(SATURDAY);
    expect(result.canPublish).toBe(false);
  });

  it('detects a missing core resource', () => {
    const employees = compliantWeek().employees.map((e) =>
      e.id === 'c1' ? { ...e, isCoreResource: false } : e,
    );
    const result = run({ employees });
    const issue = result.issues.find((i) => i.code === 'MISSING_CORE_RESOURCE');
    expect(issue?.date).toBe(SATURDAY);
    expect(result.canPublish).toBe(false);
  });

  it('detects a shift assigned over approved leave', () => {
    const result = run({
      leaves: [
        {
          id: 'l-1',
          employeeId: 'c1',
          startDate: '2026-09-02',
          endDate: '2026-09-03',
          kind: 'PLANNED',
          status: 'APPROVED',
        },
      ],
    });
    expect(result.issues.filter((i) => i.code === 'LEAVE_CONFLICT')).toHaveLength(2);
    expect(result.canPublish).toBe(false);
  });

  it('ignores leave that has not been approved', () => {
    const result = run({
      leaves: [
        {
          id: 'l-1',
          employeeId: 'c1',
          startDate: '2026-09-02',
          endDate: '2026-09-03',
          kind: 'PLANNED',
          status: 'PENDING',
        },
      ],
    });
    expect(codes(result)).not.toContain('LEAVE_CONFLICT');
  });

  it('detects two shifts on the same day (BRD 15)', () => {
    const base = compliantWeek();
    const result = run({
      assignments: [
        ...base.assignments,
        { employeeId: 'c1', date: '2026-09-02', type: 'SHIFT', shiftId: S2.id },
      ],
    });
    expect(codes(result)).toContain('DUPLICATE_SHIFT_ASSIGNMENT');
    expect(result.canPublish).toBe(false);
  });

  it('detects a seven day work streak and the missing weekly off behind it', () => {
    const assignments = compliantWeek().assignments.map((a) =>
      a.employeeId === 'c1' && a.type === 'OFF'
        ? { ...a, type: 'SHIFT' as const, shiftId: S1.id }
        : a,
    );
    const result = run({ assignments });
    expect(codes(result)).toContain('SEVEN_DAY_STREAK');
    expect(codes(result)).toContain('MISSING_WEEKLY_OFF');
    expect(result.canPublish).toBe(false);
  });

  it('detects understaffing against the shift minimum', () => {
    const base = compliantWeek();
    const result = run({
      employees: base.employees.filter((e) => e.id !== 'c1'),
      assignments: base.assignments.filter((a) => a.employeeId !== 'c1'),
    });
    const issue = result.issues.find((i) => i.code === 'CAPACITY_BELOW_MINIMUM');
    expect(issue?.date).toBe(SATURDAY);
    expect(result.canPublish).toBe(false);
  });

  it('detects overstaffing above the shift maximum', () => {
    const base = compliantWeek();
    const extras = Array.from({ length: 6 }, (_, i) => makeEmployee(`x${i}`));
    const assignments = [...base.assignments];
    for (const extra of extras) {
      for (const date of dateRange(WEEK_START, WEEK_END)) {
        assignments.push(
          date === SUNDAY
            ? { employeeId: extra.id, date, type: 'OFF' }
            : { employeeId: extra.id, date, type: 'SHIFT', shiftId: S1.id },
        );
      }
    }
    const result = run({ employees: [...base.employees, ...extras], assignments });
    expect(codes(result)).toContain('CAPACITY_ABOVE_MAXIMUM');
    expect(result.canPublish).toBe(false);
  });

  it('blocks a restricted transition unless it carries an override (BRD 17)', () => {
    const base = compliantWeek();
    // c1 jumps S1 -> S3 -> S1 across 1 and 2 September, both restricted moves.
    const swapped = base.assignments.map((a) =>
      a.employeeId === 'c1' && a.date === '2026-09-02' ? { ...a, shiftId: S3.id } : a,
    );

    const blocked = validateRoster({
      startDate: WEEK_START,
      endDate: WEEK_END,
      employees: base.employees,
      shifts: ALL_SHIFTS_NO_DEMAND,
      assignments: swapped,
    });
    expect(codes(blocked)).toContain('RESTRICTED_TRANSITION');
    expect(blocked.canPublish).toBe(false);

    const overridden = validateRoster({
      startDate: WEEK_START,
      endDate: WEEK_END,
      employees: base.employees,
      shifts: ALL_SHIFTS_NO_DEMAND,
      assignments: swapped.map((a) =>
        a.employeeId === 'c1' && (a.date === '2026-09-02' || a.date === '2026-09-03')
          ? { ...a, overrideReason: 'Approved by operations manager', overrideBy: 'mgr-1' }
          : a,
      ),
    });
    expect(codes(overridden)).not.toContain('RESTRICTED_TRANSITION');
    expect(codes(overridden)).toContain('OVERRIDDEN_TRANSITION');
  });

  it('does not treat a shift change across a rest day as a restricted transition', () => {
    const base = compliantWeek();
    // c1 finishes S3 on Friday, rests Saturday, then opens S1 on Sunday. BRD 17
    // restricts back-to-back moves, and a rest day clears the restriction.
    const assignments = base.assignments.map((a) => {
      if (a.employeeId !== 'c1') return a;
      // Rotate forward S1 -> S2 -> S3 so the only move under test is the one
      // that spans the rest day.
      if (a.date === '2026-09-03') return { ...a, type: 'SHIFT' as const, shiftId: S2.id };
      if (a.date === '2026-09-04') return { ...a, type: 'SHIFT' as const, shiftId: S3.id };
      if (a.date === SATURDAY) return { employeeId: 'c1', date: SATURDAY, type: 'OFF' as const };
      if (a.date === SUNDAY)
        return { employeeId: 'c1', date: SUNDAY, type: 'SHIFT' as const, shiftId: S1.id };
      return a;
    });
    const result = validateRoster({
      startDate: WEEK_START,
      endDate: WEEK_END,
      employees: base.employees,
      shifts: ALL_SHIFTS_NO_DEMAND,
      assignments,
    });
    expect(codes(result)).not.toContain('RESTRICTED_TRANSITION');
  });
});

describe('warnings allow publication (BRD 25)', () => {
  it('flags six consecutive days without blocking', () => {
    const result = run();
    const six = result.issues.filter((i) => i.code === 'SIX_DAY_CONSECUTIVE');
    expect(six.length).toBeGreaterThan(0);
    expect(six.every((i) => i.severity === 'WARNING')).toBe(true);
    expect(result.canPublish).toBe(true);
  });

  it('flags excessive shift rotation across a week (BRD 16)', () => {
    const base = compliantWeek();
    const rotated = base.assignments.map((a) => {
      if (a.employeeId !== 'c1' || a.type !== 'SHIFT') return a;
      if (a.date === '2026-09-01') return { ...a, shiftId: S2.id };
      if (a.date >= '2026-09-02') return { ...a, shiftId: S3.id };
      return a;
    });
    const result = validateRoster({
      startDate: WEEK_START,
      endDate: WEEK_END,
      employees: base.employees,
      shifts: ALL_SHIFTS_NO_DEMAND,
      assignments: rotated,
    });
    const rotation = result.issues.filter((i) => i.code === 'EXCESSIVE_SHIFT_ROTATION');
    expect(rotation.length).toBeGreaterThan(0);
    expect(rotation[0]?.severity).toBe('WARNING');
  });

  it('flags a short rest turnaround as a warning, not a block', () => {
    const base = compliantWeek();
    // S2 finishing at 22:00 followed by S1 starting at 06:00 leaves 8 hours.
    const assignments = base.assignments.map((a) =>
      a.employeeId === 'c1' && a.date === '2026-09-01' && a.type === 'SHIFT'
        ? { ...a, shiftId: S2.id }
        : a,
    );
    const result = validateRoster({
      startDate: WEEK_START,
      endDate: WEEK_END,
      employees: base.employees,
      shifts: ALL_SHIFTS_NO_DEMAND,
      assignments,
    });
    const rest = result.issues.filter((i) => i.code === 'INSUFFICIENT_REST');
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.every((i) => i.severity === 'WARNING')).toBe(true);
  });

  it('compares workload within a peer group, not across roles', () => {
    // Leads legitimately work more days than general staff because every shift
    // needs one. That structural difference must not read as unfairness.
    const employees = [
      makeEmployee('l1', { role: 'SHIFT_LEAD' }),
      makeEmployee('l2', { role: 'SHIFT_LEAD' }),
      makeEmployee('c1', { isCoreResource: true }),
      makeEmployee('c2', { isCoreResource: true }),
    ];
    const assignments: AssignmentRecord[] = [];
    for (const employee of employees) {
      const isLead = employee.role === 'SHIFT_LEAD';
      for (const date of dateRange(WEEK_START, WEEK_END)) {
        const working = isLead ? date !== SUNDAY : date <= '2026-09-02';
        assignments.push(
          working
            ? { employeeId: employee.id, date, type: 'SHIFT', shiftId: S1.id }
            : { employeeId: employee.id, date, type: 'OFF' },
        );
      }
    }
    const result = validateRoster({
      startDate: WEEK_START,
      endDate: WEEK_END,
      employees,
      shifts: S1_ONLY,
      assignments,
    });
    expect(codes(result)).not.toContain('UNEVEN_DISTRIBUTION');
  });

  it('does not enforce weekly offs on a partial week at the roster edge', () => {
    const employees = compliantWeek().employees;
    const assignments: AssignmentRecord[] = [];
    for (const employee of employees) {
      for (const date of dateRange('2026-09-01', '2026-09-03')) {
        assignments.push({ employeeId: employee.id, date, type: 'SHIFT', shiftId: S1.id });
      }
    }
    const result = validateRoster({
      startDate: '2026-09-01',
      endDate: '2026-09-03',
      employees,
      shifts: S1_ONLY,
      assignments,
    });
    expect(codes(result)).not.toContain('MISSING_WEEKLY_OFF');
  });
});
