/** Teams, locations, shifts and policy — the configuration surface (BRD 8, 9, 10, 16-20). */
import { Router } from 'express';
import { z } from 'zod';
import { formatMinutes, parseTimeToMinutes } from '@shift-planner/core';
import { asyncHandler, conflict, notFound } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { recordAudit } from '../services/audit.js';
import { getPolicy, savePolicy } from '../services/policy.js';

export const configRouter = Router();
configRouter.use(authenticate);

// ---- Teams (BRD 8) --------------------------------------------------------

configRouter.get(
  '/teams',
  requirePermission('team:read'),
  asyncHandler(async (_req, res) => {
    const teams = await prisma.team.findMany({
      include: {
        manager: { select: { id: true, name: true } },
        _count: { select: { employees: true } },
      },
      orderBy: { name: 'asc' },
    });
    res.json(teams);
  }),
);

configRouter.post(
  '/teams',
  requirePermission('team:write'),
  asyncHandler(async (req, res) => {
    const input = z
      .object({
        name: z.string().min(1),
        businessUnit: z.string().nullish(),
        managerId: z.string().nullish(),
      })
      .parse(req.body);

    const existing = await prisma.team.findUnique({ where: { name: input.name } });
    if (existing) throw conflict(`A team named "${input.name}" already exists`);

    const team = await prisma.team.create({ data: input });
    await recordAudit(req.user, {
      action: 'CREATE',
      entity: 'Team',
      entityId: team.id,
      updatedValue: team,
    });
    res.status(201).json(team);
  }),
);

configRouter.patch(
  '/teams/:id',
  requirePermission('team:write'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.team.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Team not found');
    const input = z
      .object({
        name: z.string().min(1).optional(),
        businessUnit: z.string().nullish(),
        managerId: z.string().nullish(),
      })
      .parse(req.body);
    const team = await prisma.team.update({ where: { id: req.params.id }, data: input });
    await recordAudit(req.user, {
      action: 'UPDATE',
      entity: 'Team',
      entityId: team.id,
      previousValue: existing,
      updatedValue: team,
    });
    res.json(team);
  }),
);

// ---- Locations (BRD 22) ---------------------------------------------------

configRouter.get(
  '/locations',
  requirePermission('holiday:read', 'team:read'),
  asyncHandler(async (_req, res) => {
    const locations = await prisma.location.findMany({
      include: { _count: { select: { employees: true, holidays: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(locations);
  }),
);

configRouter.post(
  '/locations',
  requirePermission('location:write'),
  asyncHandler(async (req, res) => {
    const input = z
      .object({ code: z.string().min(1).max(12), name: z.string().min(1) })
      .parse(req.body);
    const existing = await prisma.location.findUnique({ where: { code: input.code } });
    if (existing) throw conflict(`Location code "${input.code}" is already in use`);
    const location = await prisma.location.create({ data: input });
    await recordAudit(req.user, {
      action: 'CREATE',
      entity: 'Location',
      entityId: location.id,
      updatedValue: location,
    });
    res.status(201).json(location);
  }),
);

// ---- Shifts (BRD 9 and 10) ------------------------------------------------

const shiftFields = z.object({
  code: z.string().min(1).max(8),
  name: z.string().min(1),
  /** Accepts "06:00" or "06:00 AM"; stored as minutes from midnight. */
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  minStaff: z.number().int().min(0),
  maxStaff: z.number().int().min(1),
  shiftLeadsRequired: z.number().int().min(0),
  coreResourcesRequired: z.number().int().min(0),
  isActive: z.boolean().default(true),
});

/**
 * Capacity has to hold together, otherwise the validation engine reports a
 * shift that can never be staffed. The same two checks apply to a partial
 * update, but only when the fields involved are actually present in the patch.
 */
const capacityChecks = (
  value: Partial<z.infer<typeof shiftFields>>,
  ctx: z.RefinementCtx,
): void => {
  const { minStaff, maxStaff, shiftLeadsRequired, coreResourcesRequired } = value;
  if (minStaff !== undefined && maxStaff !== undefined && maxStaff < minStaff) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maxStaff'],
      message: 'Maximum staff must be greater than or equal to minimum staff',
    });
  }
  if (
    maxStaff !== undefined &&
    shiftLeadsRequired !== undefined &&
    coreResourcesRequired !== undefined &&
    shiftLeadsRequired + coreResourcesRequired > maxStaff
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maxStaff'],
      message: 'A shift cannot require more leads and core resources than its maximum staff',
    });
  }
};

const shiftInput = shiftFields.superRefine(capacityChecks);
const shiftPatch = shiftFields.partial().superRefine(capacityChecks);

const serialiseShift = (shift: {
  startMinutes: number;
  endMinutes: number;
  [key: string]: unknown;
}) => ({
  ...shift,
  startTime: formatMinutes(shift.startMinutes),
  endTime: formatMinutes(shift.endMinutes),
});

configRouter.get(
  '/shifts',
  requirePermission('shift:read'),
  asyncHandler(async (_req, res) => {
    const shifts = await prisma.shift.findMany({ orderBy: { startMinutes: 'asc' } });
    res.json(shifts.map(serialiseShift));
  }),
);

configRouter.post(
  '/shifts',
  requirePermission('shift:write'),
  asyncHandler(async (req, res) => {
    const input = shiftInput.parse(req.body);
    const existing = await prisma.shift.findUnique({ where: { code: input.code } });
    if (existing) throw conflict(`Shift code "${input.code}" already exists`);

    const { startTime, endTime, ...rest } = input;
    const shift = await prisma.shift.create({
      data: {
        ...rest,
        startMinutes: parseTimeToMinutes(startTime),
        endMinutes: parseTimeToMinutes(endTime),
      },
    });
    await recordAudit(req.user, {
      action: 'CREATE',
      entity: 'Shift',
      entityId: shift.id,
      updatedValue: shift,
    });
    res.status(201).json(serialiseShift(shift));
  }),
);

configRouter.patch(
  '/shifts/:id',
  requirePermission('shift:write'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.shift.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Shift not found');

    const input = shiftPatch.parse(req.body);

    const { startTime, endTime, ...rest } = input as Record<string, unknown> & {
      startTime?: string;
      endTime?: string;
    };

    const shift = await prisma.shift.update({
      where: { id: req.params.id },
      data: {
        ...(rest as object),
        ...(startTime ? { startMinutes: parseTimeToMinutes(startTime) } : {}),
        ...(endTime ? { endMinutes: parseTimeToMinutes(endTime) } : {}),
      },
    });

    await recordAudit(req.user, {
      action: 'UPDATE',
      entity: 'Shift',
      entityId: shift.id,
      previousValue: existing,
      updatedValue: shift,
      reason: typeof req.body?.reason === 'string' ? req.body.reason : null,
    });
    res.json(serialiseShift(shift));
  }),
);

// ---- Wellness policy (BRD 16-20) ------------------------------------------

configRouter.get(
  '/policy',
  requirePermission('shift:read'),
  asyncHandler(async (_req, res) => {
    res.json(await getPolicy());
  }),
);

configRouter.put(
  '/policy',
  requirePermission('settings:write'),
  asyncHandler(async (req, res) => {
    const previous = await getPolicy();
    const input = z
      .object({
        minRestHours: z.number().min(0).max(24).optional(),
        minWeeklyOffs: z.number().int().min(0).max(7).optional(),
        maxConsecutiveDays: z.number().int().min(1).max(7).optional(),
        exceptionConsecutiveDays: z.number().int().min(1).max(7).optional(),
        preferredConsecutiveDays: z.number().int().min(1).max(7).optional(),
        maxShiftChangesPerWeek: z.number().int().min(0).max(6).optional(),
        distributionTolerance: z.number().min(0).max(2).optional(),
        holidayCoverageRatio: z.number().min(0).max(1).optional(),
        restrictedTransitions: z.array(z.tuple([z.string(), z.string()])).optional(),
        preferredTransitions: z.array(z.tuple([z.string(), z.string()])).optional(),
      })
      .parse(req.body);

    const policy = await savePolicy(input);
    await recordAudit(req.user, {
      action: 'UPDATE',
      entity: 'PolicySetting',
      entityId: 'default',
      previousValue: previous,
      updatedValue: policy,
      reason: typeof req.body?.reason === 'string' ? req.body.reason : 'Policy change',
    });
    res.json(policy);
  }),
);
