import { Router } from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { ROLES } from '@shift-planner/core';
import { asyncHandler, badRequest, conflict, notFound } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { recordAudit } from '../services/audit.js';
import { buildEmployeeTemplate, parseEmployeeUpload } from '../services/employee-import.js';
import { env } from '../lib/env.js';

export const employeeRouter = Router();
employeeRouter.use(authenticate);

// Uploads are held in memory and capped: the parser needs the whole grid, and
// an unbounded upload is an easy way to exhaust the process.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (/\.(xlsx|csv)$/i.test(file.originalname)) {
      callback(null, true);
      return;
    }
    callback(badRequest('Only .xlsx and .csv files are supported'));
  },
});

const employeeInput = z.object({
  employeeId: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(ROLES),
  teamId: z.string().min(1),
  managerId: z.string().nullish(),
  teamLeadId: z.string().nullish(),
  shiftLeadId: z.string().nullish(),
  locationId: z.string().nullish(),
  isCoreResource: z.boolean().default(false),
  skillCategory: z.string().nullish(),
  shiftPreference: z.string().nullish(),
  employmentStatus: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});

employeeRouter.get(
  '/template',
  requirePermission('employee:upload'),
  asyncHandler(async (_req, res) => {
    const buffer = await buildEmployeeTemplate();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', 'attachment; filename="employee-upload-template.xlsx"');
    res.send(buffer);
  }),
);

employeeRouter.get(
  '/',
  requirePermission('employee:read'),
  asyncHandler(async (req, res) => {
    const { teamId, locationId, role, status, search } = req.query;
    const employees = await prisma.employee.findMany({
      where: {
        ...(teamId ? { teamId: String(teamId) } : {}),
        ...(locationId ? { locationId: String(locationId) } : {}),
        ...(role ? { role: String(role) } : {}),
        ...(status ? { employmentStatus: String(status) } : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: String(search) } },
                { employeeId: { contains: String(search) } },
                { email: { contains: String(search) } },
              ],
            }
          : {}),
      },
      include: {
        team: { select: { id: true, name: true } },
        location: { select: { id: true, name: true, code: true } },
      },
      orderBy: [{ name: 'asc' }],
    });
    res.json(employees);
  }),
);

employeeRouter.get(
  '/:id',
  requirePermission('employee:read'),
  asyncHandler(async (req, res) => {
    const employee = await prisma.employee.findUnique({
      where: { id: req.params.id },
      include: { team: true, location: true, manager: true, teamLead: true, shiftLead: true },
    });
    if (!employee) throw notFound('Employee not found');
    res.json(employee);
  }),
);

employeeRouter.post(
  '/',
  requirePermission('employee:write'),
  asyncHandler(async (req, res) => {
    const input = employeeInput.parse(req.body);

    const clash = await prisma.employee.findFirst({
      where: { OR: [{ employeeId: input.employeeId }, { email: input.email.toLowerCase() }] },
    });
    if (clash) {
      throw conflict(
        clash.employeeId === input.employeeId
          ? `Employee ID ${input.employeeId} already exists`
          : `${input.email} is already registered to another employee`,
      );
    }

    const employee = await prisma.employee.create({
      data: { ...input, email: input.email.toLowerCase() },
    });
    await recordAudit(req.user, {
      action: 'CREATE',
      entity: 'Employee',
      entityId: employee.id,
      updatedValue: employee,
      reason: typeof req.body?.reason === 'string' ? req.body.reason : 'Manual entry',
    });
    res.status(201).json(employee);
  }),
);

employeeRouter.patch(
  '/:id',
  requirePermission('employee:write'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Employee not found');

    const input = employeeInput.partial().parse(req.body);
    const employee = await prisma.employee.update({
      where: { id: req.params.id },
      data: { ...input, ...(input.email ? { email: input.email.toLowerCase() } : {}) },
    });

    await recordAudit(req.user, {
      action: 'UPDATE',
      entity: 'Employee',
      entityId: employee.id,
      previousValue: existing,
      updatedValue: employee,
      reason: typeof req.body?.reason === 'string' ? req.body.reason : null,
    });
    res.json(employee);
  }),
);

employeeRouter.delete(
  '/:id',
  requirePermission('employee:write'),
  asyncHandler(async (req, res) => {
    const existing = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Employee not found');

    // Employees are deactivated, never deleted: their history is referenced by
    // published rosters and by the seven-year audit trail (BRD 32).
    const employee = await prisma.employee.update({
      where: { id: req.params.id },
      data: { employmentStatus: 'INACTIVE' },
    });
    await recordAudit(req.user, {
      action: 'DEACTIVATE',
      entity: 'Employee',
      entityId: employee.id,
      previousValue: { employmentStatus: existing.employmentStatus },
      updatedValue: { employmentStatus: 'INACTIVE' },
      reason: typeof req.body?.reason === 'string' ? req.body.reason : null,
    });
    res.json(employee);
  }),
);

/**
 * Bulk upload (BRD section 7). The whole file is validated before anything is
 * written: a partially-applied import leaves the master in a state nobody can
 * reason about, so a file with any invalid row is rejected in full with a
 * per-row report. `dryRun` returns that report without writing.
 */
employeeRouter.post(
  '/upload',
  requirePermission('employee:upload'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('Attach a .xlsx or .csv file in the "file" field');

    const parsed = await parseEmployeeUpload(req.file.buffer, req.file.originalname);
    const dryRun = String(req.query.dryRun ?? req.body?.dryRun ?? '') === 'true';

    if (parsed.errors.length > 0) {
      res.status(422).json({
        applied: false,
        totalRows: parsed.totalRows,
        validRows: parsed.rows.length,
        errors: parsed.errors,
        message:
          `${parsed.errors.length} problem(s) found across ${parsed.totalRows} row(s). ` +
          'Nothing was imported — fix the rows below and upload again.',
      });
      return;
    }

    if (dryRun) {
      res.json({
        applied: false,
        dryRun: true,
        totalRows: parsed.totalRows,
        validRows: parsed.rows.length,
        errors: [],
        message: `${parsed.rows.length} row(s) are ready to import.`,
      });
      return;
    }

    // Teams and locations named in the file are created on demand so a planner
    // is not forced to pre-register them one by one.
    const teamNames = [...new Set(parsed.rows.map((r) => r.team))];
    const locationNames = [...new Set(parsed.rows.map((r) => r.location).filter(Boolean))] as string[];

    const teams = new Map<string, string>();
    for (const name of teamNames) {
      const team = await prisma.team.upsert({
        where: { name },
        create: { name },
        update: {},
      });
      teams.set(name, team.id);
    }

    const locations = new Map<string, string>();
    for (const name of locationNames) {
      const code = name.slice(0, 3).toUpperCase();
      const existing = await prisma.location.findFirst({ where: { name } });
      const location =
        existing ??
        (await prisma.location.create({
          data: { name, code: `${code}-${Math.random().toString(36).slice(2, 5).toUpperCase()}` },
        }));
      locations.set(name, location.id);
    }

    let created = 0;
    let updated = 0;

    for (const row of parsed.rows) {
      const data = {
        name: row.name,
        email: row.email,
        role: row.role,
        teamId: teams.get(row.team)!,
        locationId: row.location ? (locations.get(row.location) ?? null) : null,
        isCoreResource: row.isCoreResource,
        skillCategory: row.skillCategory ?? null,
        shiftPreference: row.shiftPreference ?? null,
        employmentStatus: row.employmentStatus,
      };

      const existing = await prisma.employee.findUnique({
        where: { employeeId: row.employeeId },
      });
      if (existing) {
        await prisma.employee.update({ where: { id: existing.id }, data });
        updated += 1;
      } else {
        await prisma.employee.create({ data: { ...data, employeeId: row.employeeId } });
        created += 1;
      }
    }

    // Reporting lines are resolved in a second pass, because a manager may
    // appear further down the same file than the people reporting to them.
    const byName = new Map(
      (await prisma.employee.findMany({ select: { id: true, name: true } })).map((e) => [
        e.name.toLowerCase(),
        e.id,
      ]),
    );
    for (const row of parsed.rows) {
      const employee = await prisma.employee.findUnique({ where: { employeeId: row.employeeId } });
      if (!employee) continue;
      await prisma.employee.update({
        where: { id: employee.id },
        data: {
          managerId: byName.get(row.manager.toLowerCase()) ?? null,
          teamLeadId: row.teamLead ? (byName.get(row.teamLead.toLowerCase()) ?? null) : null,
          shiftLeadId: row.shiftLead ? (byName.get(row.shiftLead.toLowerCase()) ?? null) : null,
        },
      });
    }

    await recordAudit(req.user, {
      action: 'BULK_IMPORT',
      entity: 'Employee',
      updatedValue: { created, updated, file: req.file.originalname },
      reason: `Employee master upload from ${req.file.originalname}`,
    });

    res.json({
      applied: true,
      totalRows: parsed.totalRows,
      created,
      updated,
      errors: [],
      message: `Imported ${created} new and updated ${updated} existing employee(s).`,
    });
  }),
);

/** Issues a login for an employee who does not yet have one. */
employeeRouter.post(
  '/:id/account',
  requirePermission('employee:write'),
  asyncHandler(async (req, res) => {
    const employee = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!employee) throw notFound('Employee not found');
    if (employee.userId) throw conflict('This employee already has a login');

    const password = z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .default(env.seedPassword)
      .parse(req.body?.password ?? env.seedPassword);

    const user = await prisma.user.create({
      data: {
        email: employee.email,
        name: employee.name,
        role: employee.role,
        passwordHash: await bcrypt.hash(password, 10),
      },
    });
    await prisma.employee.update({ where: { id: employee.id }, data: { userId: user.id } });

    await recordAudit(req.user, {
      action: 'CREATE_LOGIN',
      entity: 'User',
      entityId: user.id,
      updatedValue: { email: user.email, role: user.role },
      reason: `Login issued for employee ${employee.employeeId}`,
    });

    res.status(201).json({ id: user.id, email: user.email, role: user.role });
  }),
);
