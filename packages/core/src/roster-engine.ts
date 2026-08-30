/**
 * Auto-Roster Engine (BRD section 24).
 *
 * Generates a month of assignments from the employee master, leave calendar and
 * holiday calendar. The engine is deterministic — given the same inputs it emits
 * the same roster — so a planner can regenerate and diff with confidence.
 *
 * Strategy: a priority-ordered constructive heuristic rather than a solver.
 * Hard constraints (leave, one-shift-per-day, streak cap, restricted
 * transitions, rest) are filters that remove candidates outright; soft
 * objectives (shift stability, fairness, preference) are a weighted score used
 * to rank whoever survives. Each day is filled leads-first, then core
 * resources, then general headcount, because those are the two shortages that
 * block publication (BRD 13 and 14).
 */
import { addDays, dateRange, isoWeekKey, isWeekend } from './dates.js';
import { isPreferredTransition, resolvePolicy, type PolicyConfig } from './policy.js';
import { checkTransition, restHoursBetween } from './shift-rules.js';
import { validateRoster, type ValidationResult } from './validation-engine.js';
import type {
  AssignmentRecord,
  EmployeeRecord,
  HolidayRecord,
  LeaveRecord,
  ShiftDefinition,
} from './types.js';

export interface RosterGenerationInput {
  startDate: string;
  endDate: string;
  employees: readonly EmployeeRecord[];
  shifts: readonly ShiftDefinition[];
  leaves?: readonly LeaveRecord[];
  holidays?: readonly HolidayRecord[];
  policy?: Partial<PolicyConfig>;
  /** Manual assignments to preserve; locked entries are never reassigned. */
  existingAssignments?: readonly AssignmentRecord[];
  /** Assignments from the days immediately before `startDate`, so streaks and
   *  transitions carry across a month boundary instead of resetting. */
  priorAssignments?: readonly AssignmentRecord[];
}

export interface CoverageGap {
  date: string;
  shiftId: string;
  shiftCode: string;
  kind: 'SHIFT_LEAD' | 'CORE_RESOURCE' | 'HEADCOUNT';
  required: number;
  filled: number;
}

export interface RosterGenerationResult {
  assignments: AssignmentRecord[];
  gaps: CoverageGap[];
  validation: ValidationResult;
  stats: {
    days: number;
    employees: number;
    shiftAssignments: number;
    offDays: number;
    leaveDays: number;
    holidayDays: number;
    coveragePercentage: number;
    durationMs: number;
  };
}

/** Soft-objective weights, ordered to match the priority list in BRD 24. */
const WEIGHTS = {
  sameShiftAsYesterday: 120,
  sameShiftThisWeek: 80,
  matchesPreference: 45,
  preferredTransition: 25,
  /**
   * Applied per day of deviation from the team mean, so it is neutral early in
   * the month and grows until it can outweigh the stability bonus. This is the
   * balance point between two competing BRD 24 priorities — shift stability and
   * fair distribution — and it lets a stable block run until it starts to make
   * the workload lopsided, then rotates.
   */
  fairness: 30,
  weekendRelief: 6,
  /**
   * Charged per day once an employee is already at the preferred run length.
   * BRD 20 calls five consecutive days preferred and six an exception, so the
   * engine has to actively rotate people out at five rather than simply staying
   * inside the legal maximum. Set above the stability bonus so a long block
   * loses to a rested colleague unless coverage leaves no alternative.
   */
  streakFatigue: 150,
};

interface WorkingState {
  employee: EmployeeRecord;
  /** date -> assignment being built. */
  days: Map<string, AssignmentRecord>;
  workedTotal: number;
  streak: number;
  lastShift: { date: string; shift: ShiftDefinition } | null;
  weekShift: Map<string, string>;
  offsThisWeek: Map<string, number>;
}

export function generateRoster(input: RosterGenerationInput): RosterGenerationResult {
  const startedAt = Date.now();
  const policy = resolvePolicy(input.policy);
  const days = dateRange(input.startDate, input.endDate);
  const shifts = input.shifts.filter((s) => s.isActive);
  const shiftById = new Map(input.shifts.map((s) => [s.id, s]));
  const employees = input.employees.filter((e) => e.employmentStatus === 'ACTIVE');
  const gaps: CoverageGap[] = [];

  // ---- Build per-employee state, seeded from history ------------------------
  const state = new Map<string, WorkingState>();
  for (const employee of employees) {
    state.set(employee.id, {
      employee,
      days: new Map(),
      workedTotal: 0,
      streak: 0,
      lastShift: null,
      weekShift: new Map(),
      offsThisWeek: new Map(),
    });
  }

  // Carry the tail of the previous roster in so the first days of the month are
  // planned against reality rather than a blank slate.
  const priorByEmployee = new Map<string, AssignmentRecord[]>();
  for (const assignment of input.priorAssignments ?? []) {
    const bucket = priorByEmployee.get(assignment.employeeId);
    if (bucket) bucket.push(assignment);
    else priorByEmployee.set(assignment.employeeId, [assignment]);
  }
  for (const [employeeId, prior] of priorByEmployee) {
    const current = state.get(employeeId);
    if (!current) continue;
    const sorted = [...prior].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i <= 14; i += 1) {
      const day = addDays(input.startDate, -i);
      const found = sorted.find((a) => a.date === day);
      if (found?.type === 'SHIFT') current.streak += 1;
      else break;
    }
    const last = [...sorted].reverse().find((a) => a.type === 'SHIFT' && a.shiftId);
    if (last?.shiftId) {
      const shift = shiftById.get(last.shiftId);
      if (shift) current.lastShift = { date: last.date, shift };
    }
  }

  // ---- Pre-place leave (BRD 21) -------------------------------------------
  const leaveDays = new Map<string, Set<string>>();
  for (const leave of input.leaves ?? []) {
    if (leave.status !== 'APPROVED') continue;
    let set = leaveDays.get(leave.employeeId);
    if (!set) {
      set = new Set();
      leaveDays.set(leave.employeeId, set);
    }
    for (const day of dateRange(leave.startDate, leave.endDate)) {
      if (!days.includes(day)) continue;
      set.add(day);
      state.get(leave.employeeId)?.days.set(day, {
        employeeId: leave.employeeId,
        date: day,
        type: 'LEAVE',
        shiftId: null,
      });
    }
  }

  // ---- Pre-place holidays per location (BRD 22) ---------------------------
  const holidaysByLocation = new Map<string, Set<string>>();
  for (const holiday of input.holidays ?? []) {
    let set = holidaysByLocation.get(holiday.locationId);
    if (!set) {
      set = new Set();
      holidaysByLocation.set(holiday.locationId, set);
    }
    set.add(holiday.date);
  }
  const isHolidayFor = (employee: EmployeeRecord, date: string): boolean =>
    employee.locationId
      ? (holidaysByLocation.get(employee.locationId)?.has(date) ?? false)
      : false;

  for (const current of state.values()) {
    for (const date of days) {
      if (current.days.has(date)) continue;
      if (isHolidayFor(current.employee, date)) {
        current.days.set(date, {
          employeeId: current.employee.id,
          date,
          type: 'HOLIDAY',
          shiftId: null,
        });
      }
    }
  }

  // ---- Honour manual / locked assignments ---------------------------------
  for (const assignment of input.existingAssignments ?? []) {
    if (!assignment.locked) continue;
    const current = state.get(assignment.employeeId);
    if (!current || !days.includes(assignment.date)) continue;
    current.days.set(assignment.date, { ...assignment });
  }

  // ---- Guarantee a weekly off (BRD 19) ------------------------------------
  // Every employee gets their weekly off, but *which* day matters enormously.
  // Shift leads and core resources are scarce, and a shift cannot be published
  // without one of each (BRD 13 and 14), so if the offs for a scarce class pile
  // onto one date that date loses coverage no matter how many other people are
  // free. Rotating offs arithmetically (by index, by role bucket) keeps
  // re-colliding whenever the group size and the number of candidate days share
  // a factor, so offs are instead placed greedily against live demand: each
  // employee takes the candidate day that is currently least loaded with offs
  // *from their own scarcity class*, with weekends preferred only as a
  // tiebreak. Employees are visited in input order, so the result stays
  // deterministic.
  type ScarcityClass = 'LEAD' | 'CORE' | 'GENERAL';
  const classOf = (employee: EmployeeRecord): ScarcityClass =>
    employee.role === 'SHIFT_LEAD' ? 'LEAD' : employee.isCoreResource ? 'CORE' : 'GENERAL';

  const offLoad = new Map<string, Record<ScarcityClass, number> & { total: number }>();
  for (const date of days) {
    offLoad.set(date, { LEAD: 0, CORE: 0, GENERAL: 0, total: 0 });
  }
  // Leave and holidays already remove people from the pool, so they count as
  // load when choosing where to put the remaining offs.
  for (const current of state.values()) {
    const scarcity = classOf(current.employee);
    for (const [date, assignment] of current.days) {
      if (assignment.type === 'LEAVE' || assignment.type === 'HOLIDAY') {
        const load = offLoad.get(date);
        if (load) {
          load[scarcity] += 1;
          load.total += 1;
        }
      }
    }
  }

  const weeks = new Map<string, string[]>();
  for (const date of days) {
    const key = isoWeekKey(date);
    const bucket = weeks.get(key);
    if (bucket) bucket.push(date);
    else weeks.set(key, [date]);
  }

  for (const employee of employees) {
    const current = state.get(employee.id);
    if (!current) continue;
    const scarcity = classOf(employee);

    for (const weekDays of weeks.values()) {
      const alreadyResting = weekDays.filter((d) => {
        const type = current.days.get(d)?.type;
        return type === 'OFF' || type === 'LEAVE' || type === 'HOLIDAY';
      }).length;
      const needed = policy.minWeeklyOffs - alreadyResting;
      if (needed <= 0) continue;

      for (let i = 0; i < needed; i += 1) {
        const candidates = weekDays.filter((d) => !current.days.has(d));
        if (candidates.length === 0) break;

        let best = candidates[0] as string;
        let bestCost = Number.POSITIVE_INFINITY;
        for (const candidate of candidates) {
          const load = offLoad.get(candidate);
          if (!load) continue;
          // Same-class collisions dominate; the weekend bonus and overall load
          // only break ties between equally safe days.
          const cost = load[scarcity] * 1000 + (isWeekend(candidate) ? 0 : 50) + load.total;
          if (cost < bestCost) {
            bestCost = cost;
            best = candidate;
          }
        }

        current.days.set(best, {
          employeeId: employee.id,
          date: best,
          type: 'OFF',
          shiftId: null,
        });
        const load = offLoad.get(best);
        if (load) {
          load[scarcity] += 1;
          load.total += 1;
        }
      }
    }
  }

  // ---- Fill shifts day by day ---------------------------------------------
  const holidayDates = new Set((input.holidays ?? []).map((h) => h.date));

  for (const date of days) {
    // Reset the per-day view of who is already committed.
    const assignedToday = new Set<string>();
    for (const current of state.values()) {
      const existing = current.days.get(date);
      if (existing && existing.type !== 'HOLIDAY') assignedToday.add(current.employee.id);
      if (existing?.type === 'SHIFT') assignedToday.add(current.employee.id);
    }

    const isHoliday = holidayDates.has(date);

    /**
     * Per-shift working context for this day. Shift leads and core resources
     * are scarce, so all three staffing passes below run across *every* shift
     * before the next pass begins. Filling one shift completely before looking
     * at the next lets an early shift's bulk headcount swallow the only lead
     * left for a later shift, which surfaces as a publication-blocking coverage
     * gap on an otherwise well-staffed day.
     */
    const contexts = shifts.map((shift) => ({
      shift,
      roster: [...state.values()]
        .filter(
          (s) => s.days.get(date)?.type === 'SHIFT' && s.days.get(date)?.shiftId === shift.id,
        )
        .map((s) => s.employee.id),
      targetHeadcount: isHoliday
        ? Math.max(1, Math.ceil(shift.minStaff * policy.holidayCoverageRatio))
        : shift.minStaff,
    }));
    type Context = (typeof contexts)[number];

    const eligible = (current: WorkingState, shift: ShiftDefinition): boolean => {
      if (assignedToday.has(current.employee.id)) return false;
      const existing = current.days.get(date);
      // A holiday placeholder may be converted into a working day; leave and
      // weekly offs may not.
      if (existing && existing.type !== 'HOLIDAY') return false;
      if (leaveDays.get(current.employee.id)?.has(date)) return false;
      if (current.streak >= policy.maxConsecutiveDays) return false;
      if (current.lastShift) {
        const check = checkTransition(
          policy,
          current.lastShift.shift,
          current.lastShift.date,
          shift,
          date,
        );
        // The transition restrictions in BRD 17 govern back-to-back shifts.
        // Once a rest day intervenes the employee is free to start any shift,
        // so the restriction only applies when the previous shift was literally
        // the day before. The rest-hours check stays unconditional because it
        // already accounts for the size of the gap.
        const backToBack = current.lastShift.date === addDays(date, -1);
        if (backToBack && check.restricted) return false;
        if (check.insufficientRest) return false;
      }
      return true;
    };

    let totalWorked = 0;
    for (const current of state.values()) totalWorked += current.workedTotal;
    const meanWorked = totalWorked / Math.max(1, state.size);

    const score = (current: WorkingState, shift: ShiftDefinition): number => {
      let value = 0;
      const { employee } = current;
      if (current.lastShift?.date === addDays(date, -1)) {
        if (current.lastShift.shift.id === shift.id) value += WEIGHTS.sameShiftAsYesterday;
        else if (isPreferredTransition(policy, current.lastShift.shift.code, shift.code))
          value += WEIGHTS.preferredTransition;
      }
      if (current.weekShift.get(isoWeekKey(date)) === shift.code) {
        value += WEIGHTS.sameShiftThisWeek;
      }
      if (employee.shiftPreference && employee.shiftPreference === shift.code) {
        value += WEIGHTS.matchesPreference;
      }
      value += (meanWorked - current.workedTotal) * WEIGHTS.fairness;
      if (current.streak >= policy.preferredConsecutiveDays) {
        value -=
          WEIGHTS.streakFatigue * (current.streak - policy.preferredConsecutiveDays + 1);
      }
      if (isWeekend(date) && current.workedTotal > 0) value -= WEIGHTS.weekendRelief;
      return value;
    };

    const take = (context: Context, pool: WorkingState[], count: number): number => {
      if (count <= 0) return 0;
      const { shift, roster } = context;
      const ranked = pool
        .map((current) => ({ current, value: score(current, shift) }))
        .sort(
          (a, b) =>
            b.value - a.value ||
            a.current.employee.employeeId.localeCompare(b.current.employee.employeeId),
        );
      let taken = 0;
      for (const { current } of ranked) {
        if (taken >= count) break;
        if (roster.length >= shift.maxStaff) break;
        current.days.set(date, {
          employeeId: current.employee.id,
          date,
          type: 'SHIFT',
          shiftId: shift.id,
        });
        current.workedTotal += 1;
        current.streak += 1;
        current.lastShift = { date, shift };
        current.weekShift.set(isoWeekKey(date), shift.code);
        assignedToday.add(current.employee.id);
        roster.push(current.employee.id);
        taken += 1;
      }
      return taken;
    };

    const countIn = (context: Context, predicate: (e: EmployeeRecord) => boolean): number =>
      context.roster.filter((id) => {
        const employee = state.get(id)?.employee;
        return employee ? predicate(employee) : false;
      }).length;

    // Pass 1 — shift leads. A shortage here blocks publication (BRD 14).
    for (const context of contexts) {
      const present = countIn(context, (e) => e.role === 'SHIFT_LEAD');
      const needed = context.shift.shiftLeadsRequired - present;
      const taken = take(
        context,
        [...state.values()].filter(
          (s) => s.employee.role === 'SHIFT_LEAD' && eligible(s, context.shift),
        ),
        needed,
      );
      if (taken < needed) {
        gaps.push({
          date,
          shiftId: context.shift.id,
          shiftCode: context.shift.code,
          kind: 'SHIFT_LEAD',
          required: context.shift.shiftLeadsRequired,
          filled: present + taken,
        });
      }
    }

    // Pass 2 — core resources, likewise blocking (BRD 13).
    for (const context of contexts) {
      const present = countIn(context, (e) => e.isCoreResource);
      const needed = context.shift.coreResourcesRequired - present;
      const taken = take(
        context,
        [...state.values()].filter(
          (s) => s.employee.isCoreResource && eligible(s, context.shift),
        ),
        needed,
      );
      if (taken < needed) {
        gaps.push({
          date,
          shiftId: context.shift.id,
          shiftCode: context.shift.code,
          kind: 'CORE_RESOURCE',
          required: context.shift.coreResourcesRequired,
          filled: present + taken,
        });
      }
    }

    // Pass 3 — general headcount up to the minimum (BRD 10).
    for (const context of contexts) {
      take(
        context,
        [...state.values()].filter((s) => eligible(s, context.shift)),
        context.targetHeadcount - context.roster.length,
      );
      if (context.roster.length < context.targetHeadcount) {
        gaps.push({
          date,
          shiftId: context.shift.id,
          shiftCode: context.shift.code,
          kind: 'HEADCOUNT',
          required: context.targetHeadcount,
          filled: context.roster.length,
        });
      }
    }

    // Anyone still unplanned on this day is resting. Reset their streak so the
    // consecutive-day counter stays truthful.
    for (const current of state.values()) {
      const existing = current.days.get(date);
      if (!existing) {
        current.days.set(date, {
          employeeId: current.employee.id,
          date,
          type: 'OFF',
          shiftId: null,
        });
      }
      if ((current.days.get(date)?.type ?? 'OFF') !== 'SHIFT') current.streak = 0;
    }
  }

  // ---- Collect and validate -----------------------------------------------
  const assignments: AssignmentRecord[] = [];
  let shiftAssignments = 0;
  let offDays = 0;
  let leaveDaysCount = 0;
  let holidayDaysCount = 0;

  for (const current of state.values()) {
    for (const date of days) {
      const assignment = current.days.get(date);
      if (!assignment) continue;
      assignments.push(assignment);
      if (assignment.type === 'SHIFT') shiftAssignments += 1;
      else if (assignment.type === 'OFF') offDays += 1;
      else if (assignment.type === 'LEAVE') leaveDaysCount += 1;
      else holidayDaysCount += 1;
    }
  }

  const validation = validateRoster({
    startDate: input.startDate,
    endDate: input.endDate,
    employees,
    shifts: input.shifts,
    assignments,
    leaves: input.leaves,
    holidays: input.holidays,
    policy,
  });

  const requiredSlots = days.length * shifts.reduce((sum, s) => sum + s.minStaff, 0);
  const filledSlots = Math.min(shiftAssignments, requiredSlots);

  return {
    assignments,
    gaps,
    validation,
    stats: {
      days: days.length,
      employees: employees.length,
      shiftAssignments,
      offDays,
      leaveDays: leaveDaysCount,
      holidayDays: holidayDaysCount,
      coveragePercentage:
        requiredSlots === 0 ? 100 : Number(((filledSlots / requiredSlots) * 100).toFixed(1)),
      durationMs: Date.now() - startedAt,
    },
  };
}

export interface ReplacementSuggestion {
  employee: EmployeeRecord;
  score: number;
  reasons: string[];
}

/**
 * Ranks stand-ins for an employee who has dropped out of a shift
 * (BRD sections 13 and 21 — the emergency-leave replacement step).
 */
export function suggestReplacements(params: {
  date: string;
  shift: ShiftDefinition;
  absentEmployee: EmployeeRecord;
  employees: readonly EmployeeRecord[];
  shifts: readonly ShiftDefinition[];
  assignments: readonly AssignmentRecord[];
  leaves?: readonly LeaveRecord[];
  policy?: Partial<PolicyConfig>;
  limit?: number;
}): ReplacementSuggestion[] {
  const policy = resolvePolicy(params.policy);
  const shiftById = new Map(params.shifts.map((s) => [s.id, s]));
  const byEmployee = new Map<string, Map<string, AssignmentRecord>>();
  for (const assignment of params.assignments) {
    let byDate = byEmployee.get(assignment.employeeId);
    if (!byDate) {
      byDate = new Map();
      byEmployee.set(assignment.employeeId, byDate);
    }
    byDate.set(assignment.date, assignment);
  }

  const onLeave = new Set<string>();
  for (const leave of params.leaves ?? []) {
    if (leave.status !== 'APPROVED') continue;
    if (params.date >= leave.startDate && params.date <= leave.endDate) {
      onLeave.add(leave.employeeId);
    }
  }

  const suggestions: ReplacementSuggestion[] = [];

  for (const employee of params.employees) {
    if (employee.id === params.absentEmployee.id) continue;
    if (employee.employmentStatus !== 'ACTIVE') continue;
    if (onLeave.has(employee.id)) continue;

    const byDate = byEmployee.get(employee.id);
    const today = byDate?.get(params.date);
    if (today && today.type !== 'OFF' && today.type !== 'HOLIDAY') continue;

    const reasons: string[] = [];
    let score = 0;

    // Hard filters first.
    let streak = 0;
    for (let i = 1; i <= 14; i += 1) {
      if (byDate?.get(addDays(params.date, -i))?.type === 'SHIFT') streak += 1;
      else break;
    }
    if (streak >= policy.maxConsecutiveDays) continue;

    const yesterday = byDate?.get(addDays(params.date, -1));
    if (yesterday?.type === 'SHIFT' && yesterday.shiftId) {
      const previousShift = shiftById.get(yesterday.shiftId);
      if (previousShift) {
        const check = checkTransition(
          policy,
          previousShift,
          yesterday.date,
          params.shift,
          params.date,
        );
        if (check.restricted) continue;
        if (check.insufficientRest) continue;
        if (previousShift.id === params.shift.id) {
          score += 90;
          reasons.push(`Already on ${params.shift.code} yesterday — no shift change`);
        }
        const rest = restHoursBetween(previousShift, yesterday.date, params.shift, params.date);
        if (rest !== null && rest >= policy.minRestHours) {
          reasons.push(`${rest.toFixed(0)}h rest since last shift`);
        }
      }
    } else {
      score += 40;
      reasons.push('Rested — not working the previous day');
    }

    if (employee.role === params.absentEmployee.role) {
      score += 60;
      reasons.push(`Same role (${employee.role.replace(/_/g, ' ').toLowerCase()})`);
    }
    if (employee.isCoreResource && params.absentEmployee.isCoreResource) {
      score += 55;
      reasons.push('Core resource — preserves core coverage');
    }
    if (employee.teamId === params.absentEmployee.teamId) {
      score += 30;
      reasons.push('Same team');
    }
    if (employee.shiftPreference === params.shift.code) {
      score += 25;
      reasons.push(`Prefers ${params.shift.code}`);
    }
    if (employee.skillCategory && employee.skillCategory === params.absentEmployee.skillCategory) {
      score += 20;
      reasons.push(`Matching skill: ${employee.skillCategory}`);
    }
    if (today?.type === 'OFF') {
      score -= 15;
      reasons.push('Currently rostered off — confirm availability');
    }
    score -= streak * 5;

    suggestions.push({ employee, score, reasons });
  }

  return suggestions
    .sort((a, b) => b.score - a.score || a.employee.employeeId.localeCompare(b.employee.employeeId))
    .slice(0, params.limit ?? 10);
}
