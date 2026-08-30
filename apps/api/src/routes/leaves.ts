/** Leave management and the emergency-leave workflow (BRD section 21). */
import { Router } from 'express';
import { z } from 'zod';
import { dateRange, suggestReplacements } from '@shift-planner/core';
import { asyncHandler, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { recordAudit } from '../services/audit.js';
import { notify, userIdsForEmployees } from '../services/notifications.js';
import { getPolicy } from '../services/policy.js';
import {
  toAssignmentRecord,
  toEmployeeRecord,
  toLeaveRecord,
  toShiftDefinition,
} from '../lib/mappers.js';

export const leaveRouter = Router();
leaveRouter.use(authenticate);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format');

leaveRouter.get(
  '/',
  requirePermission('leave:read', 'leave:request'),
  asyncHandler(async (req, res) => {
    const actor = req.user!;
    const { status, employeeId, from, to } = req.query;

    // A team member only ever sees their own leave.
    const scope =
      actor.role === 'TEAM_MEMBER'
        ? { employeeId: actor.employeeId ?? '__none__' }
        : employeeId
          ? { employeeId: String(employeeId) }
          : {};

    const leaves = await prisma.leave.findMany({
      where: {
        ...scope,
        ...(status ? { status: String(status) } : {}),
        ...(from ? { endDate: { gte: String(from) } } : {}),
        ...(to ? { startDate: { lte: String(to) } } : {}),
      },
      include: {
        employee: { select: { id: true, name: true, employeeId: true, teamId: true } },
        replacement: { select: { id: true, name: true, employeeId: true } },
      },
      orderBy: { startDate: 'desc' },
    });
    res.json(leaves);
  }),
);

leaveRouter.post(
  '/',
  requirePermission('leave:request'),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        employeeId: z.string().min(1),
        startDate: isoDate,
        endDate: isoDate,
        kind: z.enum(['PLANNED', 'EMERGENCY']).default('PLANNED'),
        reason: z.string().max(500).nullish(),
      })
      .refine((value) => value.endDate >= value.startDate, {
        message: 'The end date cannot be before the start date',
        path: ['endDate'],
      })
      .parse(req.body);

    const actor = req.user!;
    if (actor.role === 'TEAM_MEMBER' && actor.employeeId !== input.employeeId) {
      throw forbidden('You can only raise leave for yourself');
    }

    const employee = await prisma.employee.findUnique({ where: { id: input.employeeId } });
    if (!employee) throw notFound('Employee not found');

    // Overlapping requests produce ambiguous rosters, so they are rejected up
    // front rather than resolved arbitrarily at generation time.
    const overlapping = await prisma.leave.findFirst({
      where: {
        employeeId: input.employeeId,
        status: { in: ['PENDING', 'APPROVED'] },
        startDate: { lte: input.endDate },
        endDate: { gte: input.startDate },
      },
    });
    if (overlapping) {
      throw conflict(
        `This overlaps an existing ${overlapping.status.toLowerCase()} leave from ` +
          `${overlapping.startDate} to ${overlapping.endDate}`,
      );
    }

    const leave = await prisma.leave.create({ data: input });

    await recordAudit(actor, {
      action: 'CREATE',
      entity: 'Leave',
      entityId: leave.id,
      updatedValue: leave,
      reason: input.reason ?? null,
    });

    const approvers = await prisma.user.findMany({
      where: { role: { in: ['MANAGER', 'SYSTEM_ADMINISTRATOR'] }, isActive: true },
      select: { id: true },
    });
    await notify({
      userIds: approvers.map((u) => u.id),
      type: 'LEAVE_REQUEST',
      title: `${input.kind === 'EMERGENCY' ? 'Emergency' : 'Planned'} leave request`,
      body: `${employee.name} requested leave from ${input.startDate} to ${input.endDate}.`,
      link: `/leave?highlight=${leave.id}`,
    });

    res.status(201).json(leave);
  }),
);

/**
 * Replacement suggestions for the days a leave request would leave uncovered
 * (BRD 21, the "Coverage Check → Replacement Suggestion" step).
 */
leaveRouter.get(
  '/:id/replacements',
  requirePermission('leave:approve', 'roster:write'),
  asyncHandler(async (req, res) => {
    const leave = await prisma.leave.findUnique({
      where: { id: req.params.id },
      include: { employee: true },
    });
    if (!leave) throw notFound('Leave request not found');

    const [employees, shifts, assignments, leaves, policy] = await Promise.all([
      prisma.employee.findMany({ where: { employmentStatus: 'ACTIVE' } }),
      prisma.shift.findMany(),
      prisma.assignment.findMany({
        where: { date: { gte: leave.startDate, lte: leave.endDate } },
      }),
      prisma.leave.findMany({ where: { status: 'APPROVED' } }),
      getPolicy(),
    ]);

    const shiftById = new Map(shifts.map((s) => [s.id, s]));
    const employeeRecords = employees.map(toEmployeeRecord);
    const shiftRecords = shifts.map(toShiftDefinition);

    // Only the days the employee is actually rostered onto a shift need cover.
    const affected = assignments.filter(
      (a) => a.employeeId === leave.employeeId && a.type === 'SHIFT' && a.shiftId,
    );

    const allAssignments = await prisma.assignment.findMany({
      where: {
        date: {
          gte: dateRange(leave.startDate, leave.endDate)[0] ?? leave.startDate,
          lte: leave.endDate,
        },
      },
    });
    // Widen the window so streak and transition checks see the surrounding days.
    const contextAssignments = await prisma.assignment.findMany({
      where: { employeeId: { in: employees.map((e) => e.id) } },
    });

    const days = affected.map((assignment) => {
      const shift = shiftById.get(assignment.shiftId!);
      if (!shift) return null;
      return {
        date: assignment.date,
        shift: { id: shift.id, code: shift.code, name: shift.name },
        suggestions: suggestReplacements({
          date: assignment.date,
          shift: toShiftDefinition(shift),
          absentEmployee: toEmployeeRecord(leave.employee),
          employees: employeeRecords,
          shifts: shiftRecords,
          assignments: contextAssignments.map(toAssignmentRecord),
          leaves: leaves.map(toLeaveRecord),
          policy,
          limit: 8,
        }).map((suggestion) => ({
          employee: {
            id: suggestion.employee.id,
            employeeId: suggestion.employee.employeeId,
            name: suggestion.employee.name,
            role: suggestion.employee.role,
            isCoreResource: suggestion.employee.isCoreResource,
          },
          score: suggestion.score,
          reasons: suggestion.reasons,
        })),
      };
    });

    void allAssignments;

    res.json({
      leave: {
        id: leave.id,
        employee: { id: leave.employee.id, name: leave.employee.name },
        startDate: leave.startDate,
        endDate: leave.endDate,
        kind: leave.kind,
      },
      affectedDays: days.filter(Boolean),
    });
  }),
);

/**
 * Approval or rejection. Approving leave rewrites the affected assignments so
 * the roster and the leave calendar can never disagree, and reports which
 * shifts that leaves short.
 */
leaveRouter.post(
  '/:id/decision',
  requirePermission('leave:approve'),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        decision: z.enum(['APPROVED', 'REJECTED']),
        reason: z.string().max(500).nullish(),
        replacementId: z.string().nullish(),
      })
      .parse(req.body);

    const leave = await prisma.leave.findUnique({
      where: { id: req.params.id },
      include: { employee: true },
    });
    if (!leave) throw notFound('Leave request not found');
    if (leave.status !== 'PENDING') {
      throw badRequest(`This request has already been ${leave.status.toLowerCase()}`);
    }

    const actor = req.user!;
    const updated = await prisma.leave.update({
      where: { id: leave.id },
      data: {
        status: input.decision,
        reason: input.reason ?? leave.reason,
        replacementId: input.replacementId ?? null,
        decidedBy: actor.id,
        decidedAt: new Date(),
      },
    });

    const uncovered: Array<{ date: string; shiftCode: string }> = [];

    if (input.decision === 'APPROVED') {
      const days = dateRange(leave.startDate, leave.endDate);
      const affected = await prisma.assignment.findMany({
        where: { employeeId: leave.employeeId, date: { in: days } },
        include: { shift: true },
      });

      for (const assignment of affected) {
        if (assignment.type === 'SHIFT' && assignment.shift) {
          if (input.replacementId) {
            // Move the shift to the replacement rather than leaving a hole.
            const alreadyBusy = await prisma.assignment.findFirst({
              where: {
                rosterId: assignment.rosterId,
                employeeId: input.replacementId,
                date: assignment.date,
              },
            });
            if (alreadyBusy) {
              await prisma.assignment.update({
                where: { id: alreadyBusy.id },
                data: { type: 'SHIFT', shiftId: assignment.shiftId, locked: true },
              });
            } else {
              await prisma.assignment.create({
                data: {
                  rosterId: assignment.rosterId,
                  employeeId: input.replacementId,
                  date: assignment.date,
                  type: 'SHIFT',
                  shiftId: assignment.shiftId,
                  locked: true,
                },
              });
            }
          } else {
            uncovered.push({ date: assignment.date, shiftCode: assignment.shift.code });
          }
        }
        await prisma.assignment.update({
          where: { id: assignment.id },
          data: { type: 'LEAVE', shiftId: null, locked: true },
        });
      }
    }

    await recordAudit(actor, {
      action: input.decision === 'APPROVED' ? 'APPROVE' : 'REJECT',
      entity: 'Leave',
      entityId: leave.id,
      previousValue: { status: leave.status },
      updatedValue: { status: input.decision, replacementId: input.replacementId ?? null },
      reason: input.reason ?? null,
    });

    const recipients = await userIdsForEmployees(
      [leave.employeeId, input.replacementId].filter((id): id is string => Boolean(id)),
    );
    await notify({
      userIds: recipients,
      type: 'LEAVE_DECISION',
      title: `Leave ${input.decision.toLowerCase()}`,
      body:
        `${leave.employee.name}'s leave from ${leave.startDate} to ${leave.endDate} was ` +
        `${input.decision.toLowerCase()}.` +
        (input.replacementId ? ' A replacement has been assigned.' : ''),
      link: '/leave',
    });

    if (uncovered.length > 0) {
      const planners = await prisma.user.findMany({
        where: { role: { in: ['MANAGER', 'SHIFT_LEAD', 'SYSTEM_ADMINISTRATOR'] }, isActive: true },
        select: { id: true },
      });
      await notify({
        userIds: planners.map((u) => u.id),
        type: 'MISSING_COVERAGE',
        title: 'Approved leave has left shifts uncovered',
        body:
          `${leave.employee.name}'s leave leaves ${uncovered.length} shift(s) short: ` +
          uncovered.map((u) => `${u.shiftCode} on ${u.date}`).join(', '),
        link: '/roster',
      });
    }

    res.json({ leave: updated, uncovered });
  }),
);
