/**
 * Validation Engine (BRD section 25).
 *
 * Runs the full rule set over a roster and classifies every finding as either a
 * CRITICAL error (publication blocked) or a WARNING (publication allowed). The
 * engine is a pure function: same roster in, same findings out, no I/O.
 */
import { addDays, dateRange, isoWeekKey } from './dates.js';
import type { PolicyConfig } from './policy.js';
import { resolvePolicy } from './policy.js';
import {
  checkTransition,
  consecutiveWorkingDaysBefore,
  indexAssignments,
  workStreaks,
} from './shift-rules.js';
import type {
  AssignmentRecord,
  EmployeeRecord,
  HolidayRecord,
  LeaveRecord,
  ShiftDefinition,
} from './types.js';

export type ValidationSeverity = 'CRITICAL' | 'WARNING';

export type ValidationCode =
  // Critical — publication blocked (BRD 25).
  | 'MISSING_SHIFT_LEAD'
  | 'MISSING_CORE_RESOURCE'
  | 'LEAVE_CONFLICT'
  | 'DUPLICATE_SHIFT_ASSIGNMENT'
  | 'SEVEN_DAY_STREAK'
  | 'CAPACITY_BELOW_MINIMUM'
  | 'CAPACITY_ABOVE_MAXIMUM'
  | 'MISSING_WEEKLY_OFF'
  | 'RESTRICTED_TRANSITION'
  | 'INACTIVE_EMPLOYEE_ASSIGNED'
  // Warning — publication allowed (BRD 25).
  | 'UNEVEN_DISTRIBUTION'
  | 'EXCESSIVE_SHIFT_ROTATION'
  | 'SIX_DAY_CONSECUTIVE'
  | 'INSUFFICIENT_REST'
  | 'OVERRIDDEN_TRANSITION';

export interface ValidationIssue {
  code: ValidationCode;
  severity: ValidationSeverity;
  message: string;
  date?: string;
  shiftId?: string;
  shiftCode?: string;
  employeeId?: string;
  employeeName?: string;
  meta?: Record<string, unknown>;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  criticalCount: number;
  warningCount: number;
  /** BRD section 25 — a single critical error blocks roster publication. */
  canPublish: boolean;
  generatedAt: string;
  checkedDays: number;
  checkedEmployees: number;
}

export interface ValidationInput {
  startDate: string;
  endDate: string;
  employees: readonly EmployeeRecord[];
  shifts: readonly ShiftDefinition[];
  assignments: readonly AssignmentRecord[];
  leaves?: readonly LeaveRecord[];
  holidays?: readonly HolidayRecord[];
  policy?: Partial<PolicyConfig>;
}

const CRITICAL_CODES = new Set<ValidationCode>([
  'MISSING_SHIFT_LEAD',
  'MISSING_CORE_RESOURCE',
  'LEAVE_CONFLICT',
  'DUPLICATE_SHIFT_ASSIGNMENT',
  'SEVEN_DAY_STREAK',
  'CAPACITY_BELOW_MINIMUM',
  'CAPACITY_ABOVE_MAXIMUM',
  'MISSING_WEEKLY_OFF',
  'RESTRICTED_TRANSITION',
  'INACTIVE_EMPLOYEE_ASSIGNED',
]);

export function severityOf(code: ValidationCode): ValidationSeverity {
  return CRITICAL_CODES.has(code) ? 'CRITICAL' : 'WARNING';
}

export function validateRoster(input: ValidationInput): ValidationResult {
  const policy = resolvePolicy(input.policy);
  const days = dateRange(input.startDate, input.endDate);
  const dayLookup = new Set(days);
  const employees = input.employees;
  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const shiftById = new Map(input.shifts.map((s) => [s.id, s]));
  const activeShifts = input.shifts.filter((s) => s.isActive);
  const issues: ValidationIssue[] = [];

  const push = (issue: Omit<ValidationIssue, 'severity'>) => {
    issues.push({ ...issue, severity: severityOf(issue.code) });
  };

  // ---- Duplicate assignments (BRD 15: one shift per day) -------------------
  const seen = new Map<string, AssignmentRecord>();
  for (const assignment of input.assignments) {
    if (!dayLookup.has(assignment.date)) continue;
    const key = `${assignment.employeeId}|${assignment.date}`;
    const existing = seen.get(key);
    if (existing) {
      const employee = employeeById.get(assignment.employeeId);
      push({
        code: 'DUPLICATE_SHIFT_ASSIGNMENT',
        message: `${employee?.name ?? assignment.employeeId} has more than one assignment on ${assignment.date}.`,
        date: assignment.date,
        employeeId: assignment.employeeId,
        employeeName: employee?.name,
        meta: { first: existing.shiftId, second: assignment.shiftId },
      });
    } else {
      seen.set(key, assignment);
    }
  }

  const byEmployee = indexAssignments(
    input.assignments.filter((a) => dayLookup.has(a.date)),
  );

  // ---- Leave conflicts (BRD 15 / 21) --------------------------------------
  const leaveDays = new Map<string, Set<string>>();
  for (const leave of input.leaves ?? []) {
    if (leave.status !== 'APPROVED') continue;
    let set = leaveDays.get(leave.employeeId);
    if (!set) {
      set = new Set();
      leaveDays.set(leave.employeeId, set);
    }
    for (const day of dateRange(leave.startDate, leave.endDate)) set.add(day);
  }

  for (const [employeeId, byDate] of byEmployee) {
    const employee = employeeById.get(employeeId);
    const onLeave = leaveDays.get(employeeId);
    if (!onLeave) continue;
    for (const [date, assignment] of byDate) {
      if (assignment.type === 'SHIFT' && onLeave.has(date)) {
        push({
          code: 'LEAVE_CONFLICT',
          message: `${employee?.name ?? employeeId} is assigned a shift on ${date} but has approved leave.`,
          date,
          employeeId,
          employeeName: employee?.name,
          shiftId: assignment.shiftId ?? undefined,
        });
      }
    }
  }

  // ---- Inactive employees --------------------------------------------------
  for (const [employeeId, byDate] of byEmployee) {
    const employee = employeeById.get(employeeId);
    if (!employee || employee.employmentStatus === 'ACTIVE') continue;
    const working = [...byDate.values()].filter((a) => a.type === 'SHIFT');
    if (working.length > 0) {
      push({
        code: 'INACTIVE_EMPLOYEE_ASSIGNED',
        message: `${employee.name} is not an active employee but holds ${working.length} shift assignment(s).`,
        employeeId,
        employeeName: employee.name,
        meta: { count: working.length },
      });
    }
  }

  // ---- Per day, per shift coverage (BRD 10, 13, 14) ------------------------
  const holidayDates = new Set((input.holidays ?? []).map((h) => h.date));

  for (const date of days) {
    for (const shift of activeShifts) {
      const assigned = input.assignments.filter(
        (a) => a.date === date && a.type === 'SHIFT' && a.shiftId === shift.id,
      );
      const headcount = assigned.length;
      const leads = assigned.filter(
        (a) => employeeById.get(a.employeeId)?.role === 'SHIFT_LEAD',
      ).length;
      const cores = assigned.filter(
        (a) => employeeById.get(a.employeeId)?.isCoreResource === true,
      ).length;

      // Holidays run on a reduced but business-defined minimum (BRD 15).
      const requiredMin = holidayDates.has(date)
        ? Math.max(1, Math.ceil(shift.minStaff * policy.holidayCoverageRatio))
        : shift.minStaff;

      if (leads < shift.shiftLeadsRequired) {
        push({
          code: 'MISSING_SHIFT_LEAD',
          message: `${shift.code} on ${date} has ${leads} of ${shift.shiftLeadsRequired} required shift lead(s).`,
          date,
          shiftId: shift.id,
          shiftCode: shift.code,
          meta: { required: shift.shiftLeadsRequired, actual: leads },
        });
      }
      if (cores < shift.coreResourcesRequired) {
        push({
          code: 'MISSING_CORE_RESOURCE',
          message: `${shift.code} on ${date} has ${cores} of ${shift.coreResourcesRequired} required core resource(s).`,
          date,
          shiftId: shift.id,
          shiftCode: shift.code,
          meta: { required: shift.coreResourcesRequired, actual: cores },
        });
      }
      if (headcount < requiredMin) {
        push({
          code: 'CAPACITY_BELOW_MINIMUM',
          message: `${shift.code} on ${date} is staffed at ${headcount}, below the minimum of ${requiredMin}.`,
          date,
          shiftId: shift.id,
          shiftCode: shift.code,
          meta: { required: requiredMin, actual: headcount },
        });
      }
      if (headcount > shift.maxStaff) {
        push({
          code: 'CAPACITY_ABOVE_MAXIMUM',
          message: `${shift.code} on ${date} is staffed at ${headcount}, above the maximum of ${shift.maxStaff}.`,
          date,
          shiftId: shift.id,
          shiftCode: shift.code,
          meta: { limit: shift.maxStaff, actual: headcount },
        });
      }
    }
  }

  // ---- Per employee: streaks, rest, transitions, weekly offs ---------------
  const workedDaysPerEmployee = new Map<string, number>();

  for (const employee of employees) {
    const byDate = byEmployee.get(employee.id);
    if (!byDate) continue;

    const streaks = workStreaks(byDate, days);
    // A streak touching the first planned day may continue from the prior
    // roster, so seed it with the run that precedes the window.
    const carryIn = consecutiveWorkingDaysBefore(byDate, days[0] as string);
    for (const streak of streaks) {
      const length =
        streak.start === days[0] ? streak.length + carryIn : streak.length;
      if (length >= 7) {
        push({
          code: 'SEVEN_DAY_STREAK',
          message: `${employee.name} works ${length} consecutive days from ${streak.start}. Seven or more is not allowed.`,
          date: streak.start,
          employeeId: employee.id,
          employeeName: employee.name,
          meta: { length, start: streak.start, end: streak.end },
        });
      } else if (length === policy.exceptionConsecutiveDays) {
        push({
          code: 'SIX_DAY_CONSECUTIVE',
          message: `${employee.name} works ${length} consecutive days from ${streak.start}. Six days is an exception and needs review.`,
          date: streak.start,
          employeeId: employee.id,
          employeeName: employee.name,
          meta: { length, start: streak.start, end: streak.end },
        });
      }
    }

    let worked = 0;
    const shiftsPerWeek = new Map<string, Set<string>>();
    let previous: { date: string; shift: ShiftDefinition } | null = null;

    for (const date of days) {
      const assignment = byDate.get(date);
      if (!assignment || assignment.type !== 'SHIFT') continue;
      const shift = assignment.shiftId ? shiftById.get(assignment.shiftId) : undefined;
      if (!shift) continue;
      worked += 1;

      const week = isoWeekKey(date);
      let codes = shiftsPerWeek.get(week);
      if (!codes) {
        codes = new Set();
        shiftsPerWeek.set(week, codes);
      }
      codes.add(shift.code);

      if (previous) {
        const check = checkTransition(policy, previous.shift, previous.date, shift, date);
        const overridden = Boolean(assignment.overrideReason);
        // BRD 17 restricts back-to-back transitions. A rest day in between
        // clears the restriction, so only adjacent days are compared — the
        // rest-hours check below still runs for any gap.
        const backToBack = previous.date === addDays(date, -1);
        if (backToBack && check.restricted && !overridden) {
          push({
            code: 'RESTRICTED_TRANSITION',
            message: `${employee.name} moves ${previous.shift.code} → ${shift.code} on ${date}. This transition requires a management override.`,
            date,
            employeeId: employee.id,
            employeeName: employee.name,
            shiftId: shift.id,
            shiftCode: shift.code,
            meta: { from: previous.shift.code, to: shift.code },
          });
        } else if (backToBack && check.restricted && overridden) {
          push({
            code: 'OVERRIDDEN_TRANSITION',
            message: `${employee.name} moves ${previous.shift.code} → ${shift.code} on ${date} under a management override.`,
            date,
            employeeId: employee.id,
            employeeName: employee.name,
            shiftCode: shift.code,
            meta: { from: previous.shift.code, to: shift.code, reason: assignment.overrideReason },
          });
        } else if (check.insufficientRest) {
          push({
            code: 'INSUFFICIENT_REST',
            message: `${employee.name} gets ${check.restHours === null ? 'overlapping shifts' : `${check.restHours.toFixed(1)}h rest`} between ${previous.shift.code} on ${previous.date} and ${shift.code} on ${date}. Minimum is ${policy.minRestHours}h.`,
            date,
            employeeId: employee.id,
            employeeName: employee.name,
            shiftCode: shift.code,
            meta: { restHours: check.restHours, minimum: policy.minRestHours },
          });
        }
      }
      previous = { date, shift };
    }
    workedDaysPerEmployee.set(employee.id, worked);

    for (const [week, codes] of shiftsPerWeek) {
      const changes = codes.size - 1;
      if (changes > policy.maxShiftChangesPerWeek) {
        push({
          code: 'EXCESSIVE_SHIFT_ROTATION',
          message: `${employee.name} works ${codes.size} different shifts in week ${week}. Stable shift blocks are preferred.`,
          employeeId: employee.id,
          employeeName: employee.name,
          meta: { week, shifts: [...codes] },
        });
      }
    }

    // Weekly off compliance is only enforced on weeks fully inside the roster
    // window, so a partial week at a month boundary cannot raise a false alarm.
    const weeks = new Map<string, string[]>();
    for (const date of days) {
      const key = isoWeekKey(date);
      const bucket = weeks.get(key);
      if (bucket) bucket.push(date);
      else weeks.set(key, [date]);
    }
    for (const [week, weekDays] of weeks) {
      if (weekDays.length < 7) continue;
      const offs = weekDays.filter((d) => {
        const type = byDate.get(d)?.type;
        return type === 'OFF' || type === 'HOLIDAY';
      }).length;
      if (offs < policy.minWeeklyOffs) {
        push({
          code: 'MISSING_WEEKLY_OFF',
          message: `${employee.name} has ${offs} weekly off(s) in week ${week}. At least ${policy.minWeeklyOffs} is required.`,
          date: weekDays[0],
          employeeId: employee.id,
          employeeName: employee.name,
          meta: { week, offs, required: policy.minWeeklyOffs },
        });
      }
    }
  }

  // ---- Fair distribution (BRD 25) -----------------------------------------
  // Workload is only compared within a peer group. Shift leads and core
  // resources are scarce and carry mandatory per-shift coverage, so they
  // legitimately work more days than general staff; measuring everyone against
  // one team-wide mean would report that structural difference as unfairness
  // every single month and bury the real outliers.
  const peerGroupOf = (employee: EmployeeRecord): string =>
    employee.role === 'SHIFT_LEAD'
      ? 'Shift leads'
      : employee.isCoreResource
        ? 'Core resources'
        : 'Team members';

  const peerGroups = new Map<string, Array<{ employeeId: string; worked: number }>>();
  for (const [employeeId, worked] of workedDaysPerEmployee) {
    const employee = employeeById.get(employeeId);
    if (!employee) continue;
    const group = peerGroupOf(employee);
    const bucket = peerGroups.get(group);
    if (bucket) bucket.push({ employeeId, worked });
    else peerGroups.set(group, [{ employeeId, worked }]);
  }

  for (const [group, members] of peerGroups) {
    if (members.length < 2) continue;
    const mean = members.reduce((sum, m) => sum + m.worked, 0) / members.length;
    if (mean <= 0) continue;
    for (const { employeeId, worked } of members) {
      const absolute = Math.abs(worked - mean);
      const deviation = absolute / mean;
      // Both tests must fail before reporting: a relative swing on a very small
      // base (2 days against a mean of 3) is arithmetic noise, not unfairness.
      if (deviation <= policy.distributionTolerance || absolute < 2) continue;
      const employee = employeeById.get(employeeId);
      push({
        code: 'UNEVEN_DISTRIBUTION',
        message: `${employee?.name ?? employeeId} works ${worked} days against a ${group.toLowerCase()} average of ${mean.toFixed(1)}.`,
        employeeId,
        employeeName: employee?.name,
        meta: {
          worked,
          peerGroup: group,
          mean: Number(mean.toFixed(2)),
          deviation: Number(deviation.toFixed(3)),
        },
      });
    }
  }

  const criticalCount = issues.filter((i) => i.severity === 'CRITICAL').length;
  return {
    issues,
    criticalCount,
    warningCount: issues.length - criticalCount,
    canPublish: criticalCount === 0,
    generatedAt: new Date().toISOString(),
    checkedDays: days.length,
    checkedEmployees: employees.length,
  };
}

/** Groups issues by code for the compliance report (BRD section 27). */
export function summariseIssues(
  result: ValidationResult,
): Array<{ code: ValidationCode; severity: ValidationSeverity; count: number }> {
  const counts = new Map<ValidationCode, number>();
  for (const issue of result.issues) {
    counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, count]) => ({ code, severity: severityOf(code), count }))
    .sort((a, b) =>
      a.severity === b.severity ? b.count - a.count : a.severity === 'CRITICAL' ? -1 : 1,
    );
}
