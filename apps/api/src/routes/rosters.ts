/**
 * Roster planning lifecycle (BRD sections 12, 24 and 25).
 *
 * DRAFT -> PENDING_APPROVAL -> APPROVED -> PUBLISHED. Validation runs on every
 * transition, and publication is refused while any critical error stands.
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  firstDayOfMonth,
  generateRoster,
  lastDayOfMonth,
  monthLabel,
  validateRoster,
  type AssignmentRecord,
} from '@shift-planner/core';
import {
  asyncHandler,
  badRequest,
  conflict,
  forbidden,
  notFound,
  pathParam,
} from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { recordAudit } from '../services/audit.js';
import { notify, userIdsForEmployees } from '../services/notifications.js';
import { getPolicy } from '../services/policy.js';
import {
  toAssignmentRecord,
  toEmployeeRecord,
  toHolidayRecord,
  toLeaveRecord,
  toShiftDefinition,
} from '../lib/mappers.js';

export const rosterRouter = Router();
rosterRouter.use(authenticate);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format');

/** Loads everything the engines need for one roster window. */
async function loadContext(teamId: string, startDate: string, endDate: string) {
  const [employees, shifts, leaves, holidays, policy] = await Promise.all([
    prisma.employee.findMany({ where: { teamId } }),
    prisma.shift.findMany(),
    prisma.leave.findMany({
      where: { status: 'APPROVED', startDate: { lte: endDate }, endDate: { gte: startDate } },
    }),
    prisma.holiday.findMany({ where: { date: { gte: startDate, lte: endDate } } }),
    getPolicy(),
  ]);

  return {
    employees: employees.map(toEmployeeRecord),
    shifts: shifts.map(toShiftDefinition),
    leaves: leaves.map(toLeaveRecord),
    holidays: holidays.map(toHolidayRecord),
    policy,
    rawEmployees: employees,
    rawShifts: shifts,
  };
}

async function runValidation(rosterId: string) {
  const roster = await prisma.roster.findUnique({
    where: { id: rosterId },
    include: { assignments: true },
  });
  if (!roster) throw notFound('Roster not found');

  const context = await loadContext(roster.teamId, roster.startDate, roster.endDate);
  const result = validateRoster({
    startDate: roster.startDate,
    endDate: roster.endDate,
    employees: context.employees,
    shifts: context.shifts,
    assignments: roster.assignments.map(toAssignmentRecord),
    leaves: context.leaves,
    holidays: context.holidays,
    policy: context.policy,
  });

  await prisma.roster.update({
    where: { id: rosterId },
    data: { validationJson: JSON.stringify(result) },
  });
  return result;
}

rosterRouter.get(
  '/',
  requirePermission('roster:read'),
  asyncHandler(async (req, res) => {
    const actor = req.user!;
    const { teamId, year, status } = req.query;

    // Anyone without org-wide read only sees their own team.
    const scoped =
      actor.role === 'TEAM_MEMBER' && actor.teamId
        ? { teamId: actor.teamId }
        : teamId
          ? { teamId: String(teamId) }
          : {};

    const rosters = await prisma.roster.findMany({
      where: {
        ...scoped,
        ...(year ? { year: Number(year) } : {}),
        ...(status ? { status: String(status) } : {}),
      },
      include: {
        team: { select: { id: true, name: true } },
        _count: { select: { assignments: true } },
      },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });

    res.json(
      rosters.map((roster) => ({
        ...roster,
        label: monthLabel(roster.year, roster.month),
        validation: roster.validationJson ? JSON.parse(roster.validationJson) : null,
        validationJson: undefined,
      })),
    );
  }),
);

rosterRouter.get(
  '/:id',
  requirePermission('roster:read'),
  asyncHandler(async (req, res) => {
    const roster = await prisma.roster.findUnique({
      where: { id: req.params.id },
      include: {
        team: true,
        assignments: {
          include: {
            employee: {
              select: {
                id: true,
                employeeId: true,
                name: true,
                role: true,
                isCoreResource: true,
                locationId: true,
              },
            },
            shift: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
    if (!roster) throw notFound('Roster not found');

    const actor = req.user!;
    // A team member may only open their own team's roster, and only sees
    // themselves in it (BRD 6 grants them "View Schedule", not the team's).
    if (actor.role === 'TEAM_MEMBER') {
      if (actor.teamId !== roster.teamId) throw forbidden('This roster belongs to another team');
      roster.assignments = roster.assignments.filter((a) => a.employeeId === actor.employeeId);
    }

    const employees = await prisma.employee.findMany({
      where: { teamId: roster.teamId },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        employeeId: true,
        name: true,
        role: true,
        isCoreResource: true,
        shiftPreference: true,
        locationId: true,
        employmentStatus: true,
      },
    });

    res.json({
      ...roster,
      label: monthLabel(roster.year, roster.month),
      employees:
        actor.role === 'TEAM_MEMBER' ? employees.filter((e) => e.id === actor.employeeId) : employees,
      validation: roster.validationJson ? JSON.parse(roster.validationJson) : null,
      validationJson: undefined,
    });
  }),
);

/** Auto-generate a month of assignments (BRD section 24). */
rosterRouter.post(
  '/generate',
  requirePermission('roster:generate'),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        teamId: z.string().min(1),
        year: z.number().int().min(2000).max(2100),
        month: z.number().int().min(1).max(12),
        /** Keep manual edits from a previous run. Defaults to true. */
        preserveLocked: z.boolean().default(true),
        /** Replace an existing draft rather than refusing. */
        overwrite: z.boolean().default(false),
      })
      .parse(req.body);

    const team = await prisma.team.findUnique({ where: { id: input.teamId } });
    if (!team) throw notFound('Team not found');

    const startDate = firstDayOfMonth(input.year, input.month);
    const endDate = lastDayOfMonth(input.year, input.month);

    const existing = await prisma.roster.findUnique({
      where: { teamId_year_month: { teamId: input.teamId, year: input.year, month: input.month } },
      include: { assignments: true },
    });

    // A published roster is what people have planned their lives around.
    // Regenerating over it silently is never the right default.
    if (existing?.status === 'PUBLISHED') {
      throw conflict(
        `The ${monthLabel(input.year, input.month)} roster for ${team.name} is already published. ` +
          'Withdraw it before regenerating.',
      );
    }
    if (existing && !input.overwrite) {
      throw conflict(
        `A ${existing.status.toLowerCase().replace('_', ' ')} roster already exists for ` +
          `${monthLabel(input.year, input.month)}. Send overwrite: true to replace it.`,
        { rosterId: existing.id, status: existing.status },
      );
    }

    const context = await loadContext(input.teamId, startDate, endDate);
    if (context.employees.length === 0) {
      throw badRequest(`${team.name} has no employees to roster.`);
    }
    if (context.shifts.filter((s) => s.isActive).length === 0) {
      throw badRequest('No active shifts are configured. Set up shifts before generating a roster.');
    }

    const lockedAssignments: AssignmentRecord[] =
      input.preserveLocked && existing
        ? existing.assignments.filter((a) => a.locked).map(toAssignmentRecord)
        : [];

    // The tail of the previous month, so streaks and transitions do not reset
    // at a month boundary.
    const priorAssignments = await prisma.assignment.findMany({
      where: {
        employeeId: { in: context.employees.map((e) => e.id) },
        date: { lt: startDate, gte: `${startDate.slice(0, 8)}01` },
      },
    });

    const result = generateRoster({
      startDate,
      endDate,
      employees: context.employees,
      shifts: context.shifts,
      leaves: context.leaves,
      holidays: context.holidays,
      policy: context.policy,
      existingAssignments: lockedAssignments,
      priorAssignments: priorAssignments.map(toAssignmentRecord),
    });

    const roster = await prisma.$transaction(async (tx) => {
      const record = existing
        ? await tx.roster.update({
            where: { id: existing.id },
            data: { status: 'DRAFT', startDate, endDate, validationJson: null },
          })
        : await tx.roster.create({
            data: {
              teamId: input.teamId,
              year: input.year,
              month: input.month,
              startDate,
              endDate,
              status: 'DRAFT',
            },
          });

      await tx.assignment.deleteMany({ where: { rosterId: record.id } });
      await tx.assignment.createMany({
        data: result.assignments.map((assignment) => ({
          rosterId: record.id,
          employeeId: assignment.employeeId,
          date: assignment.date,
          type: assignment.type,
          shiftId: assignment.shiftId ?? null,
          overrideReason: assignment.overrideReason ?? null,
          overrideBy: assignment.overrideBy ?? null,
          locked: assignment.locked ?? false,
        })),
      });

      await tx.roster.update({
        where: { id: record.id },
        data: { validationJson: JSON.stringify(result.validation) },
      });
      return record;
    });

    await recordAudit(req.user, {
      action: 'GENERATE',
      entity: 'Roster',
      entityId: roster.id,
      updatedValue: {
        team: team.name,
        period: monthLabel(input.year, input.month),
        ...result.stats,
      },
      reason: typeof req.body?.reason === 'string' ? req.body.reason : 'Auto-roster generation',
    });

    res.status(201).json({
      roster: { ...roster, label: monthLabel(input.year, input.month) },
      stats: result.stats,
      gaps: result.gaps,
      validation: result.validation,
    });
  }),
);

/** Manual assignment edit — the drag-and-drop and cell-edit path (BRD 12). */
rosterRouter.put(
  '/:id/assignments',
  requirePermission('roster:write'),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        employeeId: z.string().min(1),
        date: isoDate,
        type: z.enum(['SHIFT', 'OFF', 'LEAVE', 'HOLIDAY']),
        shiftId: z.string().nullish(),
        overrideReason: z.string().max(500).nullish(),
        reason: z.string().max(500).nullish(),
      })
      .refine((value) => value.type !== 'SHIFT' || Boolean(value.shiftId), {
        message: 'A shift assignment needs a shiftId',
        path: ['shiftId'],
      })
      .parse(req.body);

    const roster = await prisma.roster.findUnique({ where: { id: req.params.id } });
    if (!roster) throw notFound('Roster not found');
    if (roster.status === 'PUBLISHED') {
      throw conflict('This roster is published. Withdraw it before editing assignments.');
    }
    if (input.date < roster.startDate || input.date > roster.endDate) {
      throw badRequest(
        `${input.date} is outside this roster (${roster.startDate} to ${roster.endDate})`,
      );
    }

    const employee = await prisma.employee.findUnique({ where: { id: input.employeeId } });
    if (!employee) throw notFound('Employee not found');
    if (employee.teamId !== roster.teamId) {
      throw badRequest(`${employee.name} is not part of this roster's team`);
    }

    const previous = await prisma.assignment.findUnique({
      where: {
        rosterId_employeeId_date: {
          rosterId: roster.id,
          employeeId: input.employeeId,
          date: input.date,
        },
      },
      include: { shift: true },
    });

    const actor = req.user!;
    const assignment = await prisma.assignment.upsert({
      where: {
        rosterId_employeeId_date: {
          rosterId: roster.id,
          employeeId: input.employeeId,
          date: input.date,
        },
      },
      create: {
        rosterId: roster.id,
        employeeId: input.employeeId,
        date: input.date,
        type: input.type,
        shiftId: input.type === 'SHIFT' ? (input.shiftId ?? null) : null,
        overrideReason: input.overrideReason ?? null,
        overrideBy: input.overrideReason ? actor.id : null,
        // Manual edits are locked so a later regeneration does not undo them.
        locked: true,
      },
      update: {
        type: input.type,
        shiftId: input.type === 'SHIFT' ? (input.shiftId ?? null) : null,
        overrideReason: input.overrideReason ?? null,
        overrideBy: input.overrideReason ? actor.id : null,
        locked: true,
      },
      include: { shift: true },
    });

    // Re-validate immediately so the planner sees the consequence of the edit.
    const validation = await runValidation(roster.id);

    await recordAudit(actor, {
      action: 'UPDATE',
      entity: 'Assignment',
      entityId: assignment.id,
      previousValue: previous
        ? { type: previous.type, shift: previous.shift?.code ?? null, date: previous.date }
        : null,
      updatedValue: { type: assignment.type, shift: assignment.shift?.code ?? null, date: assignment.date },
      reason:
        input.reason ??
        (input.overrideReason ? `Management override: ${input.overrideReason}` : null),
    });

    if (roster.status !== 'DRAFT') {
      await prisma.roster.update({ where: { id: roster.id }, data: { status: 'DRAFT' } });
    }

    const recipients = await userIdsForEmployees([input.employeeId]);
    await notify({
      userIds: recipients,
      type: 'SHIFT_CHANGE',
      title: 'Your schedule changed',
      body:
        `${input.date}: ${previous?.shift?.code ?? previous?.type ?? 'unassigned'} → ` +
        `${assignment.shift?.code ?? assignment.type}.`,
      link: '/my-schedule',
    });

    res.json({ assignment, validation });
  }),
);

/** Bulk assignment — apply one value across many employees or days (BRD 12). */
rosterRouter.post(
  '/:id/assignments/bulk',
  requirePermission('roster:write'),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        employeeIds: z.array(z.string().min(1)).min(1),
        dates: z.array(isoDate).min(1),
        type: z.enum(['SHIFT', 'OFF', 'LEAVE', 'HOLIDAY']),
        shiftId: z.string().nullish(),
        reason: z.string().max(500).nullish(),
      })
      .refine((value) => value.type !== 'SHIFT' || Boolean(value.shiftId), {
        message: 'A shift assignment needs a shiftId',
        path: ['shiftId'],
      })
      .parse(req.body);

    const roster = await prisma.roster.findUnique({ where: { id: req.params.id } });
    if (!roster) throw notFound('Roster not found');
    if (roster.status === 'PUBLISHED') {
      throw conflict('This roster is published. Withdraw it before editing assignments.');
    }

    const outOfRange = input.dates.filter((d) => d < roster.startDate || d > roster.endDate);
    if (outOfRange.length > 0) {
      throw badRequest(`These dates fall outside the roster: ${outOfRange.join(', ')}`);
    }

    let changed = 0;
    for (const employeeId of input.employeeIds) {
      for (const date of input.dates) {
        await prisma.assignment.upsert({
          where: { rosterId_employeeId_date: { rosterId: roster.id, employeeId, date } },
          create: {
            rosterId: roster.id,
            employeeId,
            date,
            type: input.type,
            shiftId: input.type === 'SHIFT' ? (input.shiftId ?? null) : null,
            locked: true,
          },
          update: {
            type: input.type,
            shiftId: input.type === 'SHIFT' ? (input.shiftId ?? null) : null,
            locked: true,
          },
        });
        changed += 1;
      }
    }

    const validation = await runValidation(roster.id);
    await recordAudit(req.user, {
      action: 'BULK_UPDATE',
      entity: 'Assignment',
      entityId: roster.id,
      updatedValue: {
        employees: input.employeeIds.length,
        dates: input.dates.length,
        type: input.type,
        shiftId: input.shiftId ?? null,
      },
      reason: input.reason ?? 'Bulk assignment',
    });

    res.json({ changed, validation });
  }),
);

/** Run the validation engine on demand (BRD 25). */
rosterRouter.post(
  '/:id/validate',
  requirePermission('roster:read'),
  asyncHandler(async (req, res) => {
    res.json(await runValidation(pathParam(req, 'id')));
  }),
);

rosterRouter.post(
  '/:id/approve',
  requirePermission('roster:approve'),
  asyncHandler(async (req, res) => {
    const roster = await prisma.roster.findUnique({ where: { id: req.params.id } });
    if (!roster) throw notFound('Roster not found');
    if (roster.status === 'PUBLISHED') throw conflict('This roster is already published');

    const validation = await runValidation(roster.id);
    if (!validation.canPublish) {
      throw conflict(
        `${validation.criticalCount} critical error(s) must be resolved before approval.`,
        { criticalCount: validation.criticalCount },
      );
    }

    const actor = req.user!;
    const updated = await prisma.roster.update({
      where: { id: roster.id },
      data: { status: 'APPROVED', approvedAt: new Date(), approvedBy: actor.id },
    });

    await recordAudit(actor, {
      action: 'APPROVE',
      entity: 'Roster',
      entityId: roster.id,
      previousValue: { status: roster.status },
      updatedValue: { status: 'APPROVED' },
      reason: typeof req.body?.reason === 'string' ? req.body.reason : null,
    });

    res.json({ roster: updated, validation });
  }),
);

/**
 * Publication (BRD sections 10, 13, 14 and 25). Validation is re-run here
 * rather than trusting the cached result — the employee master, the leave
 * calendar or the shift capacity may have changed since approval.
 */
rosterRouter.post(
  '/:id/publish',
  requirePermission('roster:publish'),
  asyncHandler(async (req, res) => {
    const roster = await prisma.roster.findUnique({
      where: { id: req.params.id },
      include: { team: true },
    });
    if (!roster) throw notFound('Roster not found');
    if (roster.status === 'PUBLISHED') throw conflict('This roster is already published');

    const validation = await runValidation(roster.id);
    if (!validation.canPublish) {
      const planners = await prisma.user.findMany({
        where: { role: { in: ['MANAGER', 'SHIFT_LEAD', 'SYSTEM_ADMINISTRATOR'] }, isActive: true },
        select: { id: true },
      });
      await notify({
        userIds: planners.map((u) => u.id),
        type: 'VALIDATION_FAILURE',
        title: 'Roster publication blocked',
        body:
          `${roster.team.name} ${monthLabel(roster.year, roster.month)} has ` +
          `${validation.criticalCount} critical error(s).`,
        link: `/roster/${roster.id}`,
      });

      throw conflict(
        `Publication is blocked by ${validation.criticalCount} critical error(s).`,
        {
          criticalCount: validation.criticalCount,
          issues: validation.issues.filter((i) => i.severity === 'CRITICAL').slice(0, 25),
        },
      );
    }

    const actor = req.user!;
    const updated = await prisma.roster.update({
      where: { id: roster.id },
      data: { status: 'PUBLISHED', publishedAt: new Date(), publishedBy: actor.id },
    });

    await recordAudit(actor, {
      action: 'PUBLISH',
      entity: 'Roster',
      entityId: roster.id,
      previousValue: { status: roster.status },
      updatedValue: { status: 'PUBLISHED', warnings: validation.warningCount },
      reason: typeof req.body?.reason === 'string' ? req.body.reason : null,
    });

    const employees = await prisma.employee.findMany({
      where: { teamId: roster.teamId },
      select: { id: true },
    });
    await notify({
      userIds: await userIdsForEmployees(employees.map((e) => e.id)),
      type: 'ROSTER_PUBLISHED',
      title: `${monthLabel(roster.year, roster.month)} roster published`,
      body: `The ${roster.team.name} roster for ${monthLabel(roster.year, roster.month)} is now live.`,
      link: '/my-schedule',
    });

    res.json({ roster: updated, validation });
  }),
);

/** Withdraw a published roster back to draft so it can be corrected. */
rosterRouter.post(
  '/:id/withdraw',
  requirePermission('roster:publish'),
  asyncHandler(async (req, res) => {
    const roster = await prisma.roster.findUnique({ where: { id: req.params.id } });
    if (!roster) throw notFound('Roster not found');
    if (roster.status !== 'PUBLISHED') throw badRequest('Only a published roster can be withdrawn');

    const reason = z
      .string()
      .min(3, 'Give a reason so the audit trail explains why a live roster was withdrawn')
      .parse(req.body?.reason);

    const updated = await prisma.roster.update({
      where: { id: roster.id },
      data: { status: 'DRAFT', publishedAt: null, publishedBy: null },
    });

    await recordAudit(req.user, {
      action: 'WITHDRAW',
      entity: 'Roster',
      entityId: roster.id,
      previousValue: { status: 'PUBLISHED' },
      updatedValue: { status: 'DRAFT' },
      reason,
    });

    const employees = await prisma.employee.findMany({
      where: { teamId: roster.teamId },
      select: { id: true },
    });
    await notify({
      userIds: await userIdsForEmployees(employees.map((e) => e.id)),
      type: 'SHIFT_CHANGE',
      title: `${monthLabel(roster.year, roster.month)} roster withdrawn`,
      body: `The roster is being revised: ${reason}`,
      link: '/my-schedule',
    });

    res.json(updated);
  }),
);
