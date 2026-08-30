/**
 * Reporting & Analytics (BRD section 27).
 *
 * Pure projections over a roster. Keeping them here rather than in SQL means the
 * web client can preview a report against an unsaved draft roster using exactly
 * the same code the API runs against a published one.
 */
import { dateRange, isoWeekKey } from './dates.js';
import { isNightShift, indexAssignments, workStreaks } from './shift-rules.js';
import { summariseIssues, type ValidationResult } from './validation-engine.js';
import type {
  AssignmentRecord,
  EmployeeRecord,
  HolidayRecord,
  ShiftDefinition,
} from './types.js';

export interface ReportInput {
  startDate: string;
  endDate: string;
  employees: readonly EmployeeRecord[];
  shifts: readonly ShiftDefinition[];
  assignments: readonly AssignmentRecord[];
  holidays?: readonly HolidayRecord[];
}

export interface CoverageRow {
  date: string;
  shiftId: string;
  shiftCode: string;
  required: number;
  assigned: number;
  maxStaff: number;
  shiftLeadsRequired: number;
  shiftLeadsAssigned: number;
  coreRequired: number;
  coreAssigned: number;
  status: 'COVERED' | 'UNDER_STAFFED' | 'OVER_STAFFED' | 'MISSING_ROLE';
}

/** Coverage Report — required vs assigned resources. */
export function coverageReport(input: ReportInput): CoverageRow[] {
  const employeeById = new Map(input.employees.map((e) => [e.id, e]));
  const rows: CoverageRow[] = [];

  for (const date of dateRange(input.startDate, input.endDate)) {
    for (const shift of input.shifts.filter((s) => s.isActive)) {
      const assigned = input.assignments.filter(
        (a) => a.date === date && a.type === 'SHIFT' && a.shiftId === shift.id,
      );
      const leads = assigned.filter(
        (a) => employeeById.get(a.employeeId)?.role === 'SHIFT_LEAD',
      ).length;
      const cores = assigned.filter(
        (a) => employeeById.get(a.employeeId)?.isCoreResource === true,
      ).length;

      let status: CoverageRow['status'] = 'COVERED';
      if (leads < shift.shiftLeadsRequired || cores < shift.coreResourcesRequired) {
        status = 'MISSING_ROLE';
      } else if (assigned.length < shift.minStaff) {
        status = 'UNDER_STAFFED';
      } else if (assigned.length > shift.maxStaff) {
        status = 'OVER_STAFFED';
      }

      rows.push({
        date,
        shiftId: shift.id,
        shiftCode: shift.code,
        required: shift.minStaff,
        assigned: assigned.length,
        maxStaff: shift.maxStaff,
        shiftLeadsRequired: shift.shiftLeadsRequired,
        shiftLeadsAssigned: leads,
        coreRequired: shift.coreResourcesRequired,
        coreAssigned: cores,
        status,
      });
    }
  }
  return rows;
}

export interface UtilizationRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  team: string;
  workedDays: number;
  leaveDays: number;
  offDays: number;
  holidayDays: number;
  utilizationPercentage: number;
}

/** Utilization Report — worked days, leave days, off days. */
export function utilizationReport(
  input: ReportInput,
  teamNames?: Map<string, string>,
): UtilizationRow[] {
  const byEmployee = indexAssignments(input.assignments);
  const days = dateRange(input.startDate, input.endDate);

  return input.employees.map((employee) => {
    const byDate = byEmployee.get(employee.id);
    let workedDays = 0;
    let leaveDays = 0;
    let offDays = 0;
    let holidayDays = 0;
    for (const date of days) {
      switch (byDate?.get(date)?.type) {
        case 'SHIFT': workedDays += 1; break;
        case 'LEAVE': leaveDays += 1; break;
        case 'OFF': offDays += 1; break;
        case 'HOLIDAY': holidayDays += 1; break;
        default: break;
      }
    }
    const plannable = days.length - leaveDays - holidayDays;
    return {
      employeeId: employee.id,
      employeeCode: employee.employeeId,
      name: employee.name,
      team: teamNames?.get(employee.teamId) ?? employee.teamId,
      workedDays,
      leaveDays,
      offDays,
      holidayDays,
      utilizationPercentage:
        plannable <= 0 ? 0 : Number(((workedDays / plannable) * 100).toFixed(1)),
    };
  });
}

export interface WellnessRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  maxConsecutiveDays: number;
  nightShifts: number;
  holidaysWorked: number;
  weeklyOffs: number;
  status: 'HEALTHY' | 'REVIEW' | 'BREACH';
}

/** Wellness Report — consecutive days, night shifts, holiday work. */
export function wellnessReport(input: ReportInput): WellnessRow[] {
  const byEmployee = indexAssignments(input.assignments);
  const days = dateRange(input.startDate, input.endDate);
  const shiftById = new Map(input.shifts.map((s) => [s.id, s]));
  const holidayDates = new Set((input.holidays ?? []).map((h) => h.date));

  return input.employees.map((employee) => {
    const byDate = byEmployee.get(employee.id);
    const streaks = workStreaks(byDate, days);
    const maxConsecutiveDays = streaks.reduce((max, s) => Math.max(max, s.length), 0);

    let nightShifts = 0;
    let holidaysWorked = 0;
    let weeklyOffs = 0;
    for (const date of days) {
      const assignment = byDate?.get(date);
      if (!assignment) continue;
      if (assignment.type === 'OFF') weeklyOffs += 1;
      if (assignment.type !== 'SHIFT' || !assignment.shiftId) continue;
      const shift = shiftById.get(assignment.shiftId);
      if (shift && isNightShift(shift)) nightShifts += 1;
      if (holidayDates.has(date)) holidaysWorked += 1;
    }

    const status: WellnessRow['status'] =
      maxConsecutiveDays >= 7 ? 'BREACH' : maxConsecutiveDays >= 6 ? 'REVIEW' : 'HEALTHY';

    return {
      employeeId: employee.id,
      employeeCode: employee.employeeId,
      name: employee.name,
      maxConsecutiveDays,
      nightShifts,
      holidaysWorked,
      weeklyOffs,
      status,
    };
  });
}

export interface DistributionRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  counts: Record<string, number>;
  total: number;
}

export interface DistributionReport {
  shiftCodes: string[];
  rows: DistributionRow[];
  totals: Record<string, number>;
}

/** Shift Distribution Report — S1 / S2 / S3 counts per employee. */
export function distributionReport(input: ReportInput): DistributionReport {
  const byEmployee = indexAssignments(input.assignments);
  const days = dateRange(input.startDate, input.endDate);
  const shiftById = new Map(input.shifts.map((s) => [s.id, s]));
  const shiftCodes = input.shifts.filter((s) => s.isActive).map((s) => s.code);
  const totals: Record<string, number> = Object.fromEntries(shiftCodes.map((c) => [c, 0]));

  const rows = input.employees.map((employee) => {
    const byDate = byEmployee.get(employee.id);
    const counts: Record<string, number> = Object.fromEntries(shiftCodes.map((c) => [c, 0]));
    let total = 0;
    for (const date of days) {
      const assignment = byDate?.get(date);
      if (assignment?.type !== 'SHIFT' || !assignment.shiftId) continue;
      const code = shiftById.get(assignment.shiftId)?.code;
      if (!code || !(code in counts)) continue;
      counts[code] = (counts[code] ?? 0) + 1;
      totals[code] = (totals[code] ?? 0) + 1;
      total += 1;
    }
    return {
      employeeId: employee.id,
      employeeCode: employee.employeeId,
      name: employee.name,
      counts,
      total,
    };
  });

  return { shiftCodes, rows, totals };
}

export interface ComplianceReport {
  summary: ReturnType<typeof summariseIssues>;
  criticalCount: number;
  warningCount: number;
  canPublish: boolean;
  byWeek: Array<{ week: string; critical: number; warning: number }>;
}

/** Compliance Report — violations, exceptions, resolution status. */
export function complianceReport(validation: ValidationResult): ComplianceReport {
  const byWeek = new Map<string, { critical: number; warning: number }>();
  for (const issue of validation.issues) {
    if (!issue.date) continue;
    const week = isoWeekKey(issue.date);
    const bucket = byWeek.get(week) ?? { critical: 0, warning: 0 };
    if (issue.severity === 'CRITICAL') bucket.critical += 1;
    else bucket.warning += 1;
    byWeek.set(week, bucket);
  }
  return {
    summary: summariseIssues(validation),
    criticalCount: validation.criticalCount,
    warningCount: validation.warningCount,
    canPublish: validation.canPublish,
    byWeek: [...byWeek.entries()]
      .map(([week, counts]) => ({ week, ...counts }))
      .sort((a, b) => a.week.localeCompare(b.week)),
  };
}
