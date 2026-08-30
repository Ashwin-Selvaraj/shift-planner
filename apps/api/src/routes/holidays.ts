/** Holiday calendars and holiday compensation (BRD sections 22 and 23). */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, conflict, forbidden, notFound } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { recordAudit } from '../services/audit.js';

export const holidayRouter = Router();
holidayRouter.use(authenticate);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format');

holidayRouter.get(
  '/',
  requirePermission('holiday:read'),
  asyncHandler(async (req, res) => {
    const { locationId, from, to } = req.query;
    const holidays = await prisma.holiday.findMany({
      where: {
        ...(locationId ? { locationId: String(locationId) } : {}),
        ...(from || to
          ? {
              date: {
                ...(from ? { gte: String(from) } : {}),
                ...(to ? { lte: String(to) } : {}),
              },
            }
          : {}),
      },
      include: { location: { select: { id: true, name: true, code: true } } },
      orderBy: { date: 'asc' },
    });
    res.json(holidays);
  }),
);

holidayRouter.post(
  '/',
  requirePermission('holiday:write'),
  asyncHandler(async (req, res) => {
    const input = z
      .object({ locationId: z.string().min(1), date: isoDate, name: z.string().min(1) })
      .parse(req.body);

    const location = await prisma.location.findUnique({ where: { id: input.locationId } });
    if (!location) throw notFound('Location not found');

    const existing = await prisma.holiday.findUnique({
      where: { locationId_date: { locationId: input.locationId, date: input.date } },
    });
    if (existing) {
      throw conflict(`${location.name} already has a holiday on ${input.date}: ${existing.name}`);
    }

    const holiday = await prisma.holiday.create({ data: input });
    await recordAudit(req.user, {
      action: 'CREATE',
      entity: 'Holiday',
      entityId: holiday.id,
      updatedValue: holiday,
    });
    res.status(201).json(holiday);
  }),
);

holidayRouter.delete(
  '/:id',
  requirePermission('holiday:write'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.holiday.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Holiday not found');
    await prisma.holiday.delete({ where: { id: req.params.id } });
    await recordAudit(req.user, {
      action: 'DELETE',
      entity: 'Holiday',
      entityId: req.params.id,
      previousValue: existing,
      reason: typeof req.body?.reason === 'string' ? req.body.reason : null,
    });
    res.status(204).end();
  }),
);

/**
 * Holiday compensation (BRD 23). An employee who worked a holiday chooses
 * comp-off or double pay, and only one — the unique constraint on
 * (employee, date) enforces that, and re-submitting replaces the earlier choice
 * rather than stacking a second entitlement.
 */
holidayRouter.post(
  '/compensation',
  requirePermission('leave:request'),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        employeeId: z.string().min(1),
        date: isoDate,
        choice: z.enum(['COMP_OFF', 'DOUBLE_PAY']),
      })
      .parse(req.body);

    const actor = req.user!;
    // A team member may only choose for themselves.
    if (actor.role === 'TEAM_MEMBER' && actor.employeeId !== input.employeeId) {
      throw forbidden('You can only select holiday compensation for yourself');
    }

    const worked = await prisma.assignment.findFirst({
      where: { employeeId: input.employeeId, date: input.date, type: 'SHIFT' },
    });
    if (!worked) {
      throw conflict(
        'Holiday compensation can only be claimed for a holiday the employee actually worked',
      );
    }

    const previous = await prisma.holidayCompensation.findUnique({
      where: { employeeId_date: { employeeId: input.employeeId, date: input.date } },
    });

    const compensation = await prisma.holidayCompensation.upsert({
      where: { employeeId_date: { employeeId: input.employeeId, date: input.date } },
      create: input,
      update: { choice: input.choice },
    });

    await recordAudit(actor, {
      action: previous ? 'UPDATE' : 'CREATE',
      entity: 'HolidayCompensation',
      entityId: compensation.id,
      previousValue: previous ? { choice: previous.choice } : null,
      updatedValue: { choice: compensation.choice },
      reason: `Holiday compensation for ${input.date}`,
    });

    res.status(previous ? 200 : 201).json(compensation);
  }),
);

holidayRouter.get(
  '/compensation',
  requirePermission('leave:read', 'report:read'),
  asyncHandler(async (req, res) => {
    const { employeeId, from, to } = req.query;
    const rows = await prisma.holidayCompensation.findMany({
      where: {
        ...(employeeId ? { employeeId: String(employeeId) } : {}),
        ...(from || to
          ? { date: { ...(from ? { gte: String(from) } : {}), ...(to ? { lte: String(to) } : {}) } }
          : {}),
      },
      include: { employee: { select: { id: true, name: true, employeeId: true } } },
      orderBy: { date: 'desc' },
    });
    res.json(rows);
  }),
);
