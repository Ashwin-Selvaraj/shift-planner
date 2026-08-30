/**
 * Low-level shift arithmetic shared by the validation and roster engines
 * (BRD sections 17, 18 and 20).
 */
import { addDays, daysBetween } from './dates.js';
import { isRestrictedTransition, type PolicyConfig } from './policy.js';
import type { AssignmentRecord, ShiftDefinition } from './types.js';

/** A shift crosses midnight when it ends at or before the minute it starts. */
export function crossesMidnight(shift: ShiftDefinition): boolean {
  return shift.endMinutes <= shift.startMinutes;
}

export function shiftDurationMinutes(shift: ShiftDefinition): number {
  return crossesMidnight(shift)
    ? 1440 - shift.startMinutes + shift.endMinutes
    : shift.endMinutes - shift.startMinutes;
}

/** Absolute minute at which a shift worked on `date` ends, measured from the start of `date`. */
function endMinuteFromDayStart(shift: ShiftDefinition): number {
  return crossesMidnight(shift) ? 1440 + shift.endMinutes : shift.endMinutes;
}

/**
 * Hours of rest between a shift worked on `fromDate` and one worked on
 * `toDate`. Returns `null` when the two shifts overlap, which the caller treats
 * as an impossible assignment rather than a rest shortfall.
 */
export function restHoursBetween(
  fromShift: ShiftDefinition,
  fromDate: string,
  toShift: ShiftDefinition,
  toDate: string,
): number | null {
  const dayGap = daysBetween(fromDate, toDate);
  const endsAt = endMinuteFromDayStart(fromShift);
  const startsAt = dayGap * 1440 + toShift.startMinutes;
  const gap = startsAt - endsAt;
  return gap < 0 ? null : gap / 60;
}

/** A night shift is any shift that runs across midnight (BRD section 27 wellness report). */
export function isNightShift(shift: ShiftDefinition): boolean {
  return crossesMidnight(shift);
}

export interface TransitionCheck {
  allowed: boolean;
  restricted: boolean;
  restHours: number | null;
  insufficientRest: boolean;
}

/**
 * Evaluates a proposed move from one shift to another. `restricted` reflects the
 * enumerated list in BRD section 17 (hard, override-only); `insufficientRest`
 * reflects the general rest rule in section 18 (advisory).
 */
export function checkTransition(
  policy: PolicyConfig,
  fromShift: ShiftDefinition,
  fromDate: string,
  toShift: ShiftDefinition,
  toDate: string,
): TransitionCheck {
  const restricted = isRestrictedTransition(policy, fromShift.code, toShift.code);
  const restHours = restHoursBetween(fromShift, fromDate, toShift, toDate);
  const insufficientRest = restHours === null || restHours < policy.minRestHours;
  return {
    allowed: !restricted && !insufficientRest,
    restricted,
    restHours,
    insufficientRest,
  };
}

export type AssignmentsByEmployee = Map<string, Map<string, AssignmentRecord>>;

/** Indexes assignments as `employeeId -> date -> assignment` for O(1) lookups. */
export function indexAssignments(
  assignments: readonly AssignmentRecord[],
): AssignmentsByEmployee {
  const index: AssignmentsByEmployee = new Map();
  for (const assignment of assignments) {
    let byDate = index.get(assignment.employeeId);
    if (!byDate) {
      byDate = new Map();
      index.set(assignment.employeeId, byDate);
    }
    byDate.set(assignment.date, assignment);
  }
  return index;
}

/**
 * Length of the run of consecutive working days ending on the day before
 * `date`. Used to stop the roster engine from ever creating a 7-day streak.
 */
export function consecutiveWorkingDaysBefore(
  byDate: Map<string, AssignmentRecord> | undefined,
  date: string,
  lookback = 14,
): number {
  if (!byDate) return 0;
  let streak = 0;
  for (let i = 1; i <= lookback; i += 1) {
    const assignment = byDate.get(addDays(date, -i));
    if (assignment?.type === 'SHIFT') streak += 1;
    else break;
  }
  return streak;
}

/** Every run of consecutive `SHIFT` days within the supplied date window. */
export function workStreaks(
  byDate: Map<string, AssignmentRecord> | undefined,
  days: readonly string[],
): Array<{ start: string; end: string; length: number }> {
  const streaks: Array<{ start: string; end: string; length: number }> = [];
  if (!byDate) return streaks;
  let start: string | null = null;
  let length = 0;
  let previous: string | null = null;

  for (const day of days) {
    if (byDate.get(day)?.type === 'SHIFT') {
      if (start === null) {
        start = day;
        length = 0;
      }
      length += 1;
      previous = day;
    } else if (start !== null && previous !== null) {
      streaks.push({ start, end: previous, length });
      start = null;
      length = 0;
    }
  }
  if (start !== null && previous !== null) {
    streaks.push({ start, end: previous, length });
  }
  return streaks;
}
