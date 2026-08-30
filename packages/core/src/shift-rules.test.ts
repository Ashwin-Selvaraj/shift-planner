import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY } from './policy.js';
import {
  checkTransition,
  consecutiveWorkingDaysBefore,
  crossesMidnight,
  indexAssignments,
  isNightShift,
  restHoursBetween,
  shiftDurationMinutes,
  workStreaks,
} from './shift-rules.js';
import { DEFAULT_SHIFTS } from './test-fixtures.js';
import type { AssignmentRecord } from './types.js';

const [S1, S2, S3] = DEFAULT_SHIFTS as [
  (typeof DEFAULT_SHIFTS)[number],
  (typeof DEFAULT_SHIFTS)[number],
  (typeof DEFAULT_SHIFTS)[number],
];

describe('shift geometry', () => {
  it('identifies the overnight shift', () => {
    expect(crossesMidnight(S1)).toBe(false);
    expect(crossesMidnight(S3)).toBe(true);
    expect(isNightShift(S3)).toBe(true);
  });

  it('computes an 8 hour duration for every default shift', () => {
    for (const shift of DEFAULT_SHIFTS) {
      expect(shiftDurationMinutes(shift)).toBe(480);
    }
  });
});

describe('rest periods (BRD 18)', () => {
  it('allows same-shift sequences', () => {
    expect(restHoursBetween(S1, '2026-09-01', S1, '2026-09-02')).toBe(16);
    expect(restHoursBetween(S2, '2026-09-01', S2, '2026-09-02')).toBe(16);
    expect(restHoursBetween(S3, '2026-09-01', S3, '2026-09-02')).toBe(16);
  });

  it('gives zero rest for S3 followed by S1 the next morning', () => {
    expect(restHoursBetween(S3, '2026-09-01', S1, '2026-09-02')).toBe(0);
  });

  it('flags a short turnaround from S2 into S1', () => {
    const rest = restHoursBetween(S2, '2026-09-01', S1, '2026-09-02');
    expect(rest).toBe(8);
    expect(rest as number).toBeLessThan(DEFAULT_POLICY.minRestHours);
  });
});

describe('transition rules (BRD 17)', () => {
  it('permits the preferred forward rotations', () => {
    expect(checkTransition(DEFAULT_POLICY, S1, '2026-09-01', S2, '2026-09-02').allowed).toBe(true);
    expect(checkTransition(DEFAULT_POLICY, S2, '2026-09-01', S3, '2026-09-02').allowed).toBe(true);
  });

  it('restricts S1 to S3 and S3 to S1', () => {
    const forward = checkTransition(DEFAULT_POLICY, S1, '2026-09-01', S3, '2026-09-02');
    const backward = checkTransition(DEFAULT_POLICY, S3, '2026-09-01', S1, '2026-09-02');
    expect(forward.restricted).toBe(true);
    expect(forward.allowed).toBe(false);
    expect(backward.restricted).toBe(true);
    expect(backward.allowed).toBe(false);
  });

  it('separates a rest shortfall from an outright restriction', () => {
    const check = checkTransition(DEFAULT_POLICY, S2, '2026-09-01', S1, '2026-09-02');
    expect(check.restricted).toBe(false);
    expect(check.insufficientRest).toBe(true);
  });
});

describe('consecutive working days (BRD 20)', () => {
  const assignments: AssignmentRecord[] = [
    { employeeId: 'e1', date: '2026-09-01', type: 'SHIFT', shiftId: S1.id },
    { employeeId: 'e1', date: '2026-09-02', type: 'SHIFT', shiftId: S1.id },
    { employeeId: 'e1', date: '2026-09-03', type: 'SHIFT', shiftId: S1.id },
    { employeeId: 'e1', date: '2026-09-04', type: 'OFF' },
    { employeeId: 'e1', date: '2026-09-05', type: 'SHIFT', shiftId: S1.id },
    { employeeId: 'e1', date: '2026-09-06', type: 'SHIFT', shiftId: S1.id },
  ];
  const byDate = indexAssignments(assignments).get('e1');

  it('counts the run ending before a date', () => {
    expect(consecutiveWorkingDaysBefore(byDate, '2026-09-04')).toBe(3);
    expect(consecutiveWorkingDaysBefore(byDate, '2026-09-05')).toBe(0);
    expect(consecutiveWorkingDaysBefore(byDate, '2026-09-07')).toBe(2);
  });

  it('splits streaks around rest days', () => {
    const days = [
      '2026-09-01', '2026-09-02', '2026-09-03',
      '2026-09-04', '2026-09-05', '2026-09-06',
    ];
    expect(workStreaks(byDate, days)).toEqual([
      { start: '2026-09-01', end: '2026-09-03', length: 3 },
      { start: '2026-09-05', end: '2026-09-06', length: 2 },
    ]);
  });
});
