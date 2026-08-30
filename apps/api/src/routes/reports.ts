/** Reporting and analytics (BRD section 27). */
import { Router } from 'express';
import {
  complianceReport,
  coverageReport,
  distributionReport,
  utilizationReport,
  validateRoster,
  wellnessReport,
} from '@shift-planner/core';
import { asyncHandler, notFound, pathParam } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { getPolicy } from '../services/policy.js';
import {
  toAssignmentRecord,
  toEmployeeRecord,
  toHolidayRecord,
  toLeaveRecord,
  toShiftDefinition,
} from '../lib/mappers.js';

export const reportRouter = Router();
reportRouter.use(authenticate, requirePermission('report:read'));

/** Assembles the report input for one roster, shared by all five reports. */
async function reportContext(rosterId: string) {
  const roster = await prisma.roster.findUnique({
    where: { id: rosterId },
    include: { assignments: true, team: true },
  });
  if (!roster) throw notFound('Roster not found');

  const [employees, shifts, holidays, leaves, teams] = await Promise.all([
    prisma.employee.findMany({ where: { teamId: roster.teamId } }),
    prisma.shift.findMany(),
    prisma.holiday.findMany({ where: { date: { gte: roster.startDate, lte: roster.endDate } } }),
    prisma.leave.findMany({
      where: {
        status: 'APPROVED',
        startDate: { lte: roster.endDate },
        endDate: { gte: roster.startDate },
      },
    }),
    prisma.team.findMany({ select: { id: true, name: true } }),
  ]);

  return {
    roster,
    input: {
      startDate: roster.startDate,
      endDate: roster.endDate,
      employees: employees.map(toEmployeeRecord),
      shifts: shifts.map(toShiftDefinition),
      assignments: roster.assignments.map(toAssignmentRecord),
      holidays: holidays.map(toHolidayRecord),
    },
    leaves: leaves.map(toLeaveRecord),
    teamNames: new Map(teams.map((t) => [t.id, t.name])),
  };
}

reportRouter.get(
  '/coverage/:rosterId',
  asyncHandler(async (req, res) => {
    const { roster, input } = await reportContext(pathParam(req, 'rosterId'));
    const rows = coverageReport(input);
    res.json({
      roster: { id: roster.id, team: roster.team.name, start: roster.startDate, end: roster.endDate },
      rows,
      summary: {
        total: rows.length,
        covered: rows.filter((r) => r.status === 'COVERED').length,
        underStaffed: rows.filter((r) => r.status === 'UNDER_STAFFED').length,
        overStaffed: rows.filter((r) => r.status === 'OVER_STAFFED').length,
        missingRole: rows.filter((r) => r.status === 'MISSING_ROLE').length,
        coveragePercentage:
          rows.length === 0
            ? 100
            : Number(
                ((rows.filter((r) => r.status === 'COVERED').length / rows.length) * 100).toFixed(1),
              ),
      },
    });
  }),
);

reportRouter.get(
  '/utilization/:rosterId',
  asyncHandler(async (req, res) => {
    const { input, teamNames } = await reportContext(pathParam(req, 'rosterId'));
    res.json({ rows: utilizationReport(input, teamNames) });
  }),
);

reportRouter.get(
  '/wellness/:rosterId',
  asyncHandler(async (req, res) => {
    const { input } = await reportContext(pathParam(req, 'rosterId'));
    const rows = wellnessReport(input);
    res.json({
      rows,
      summary: {
        healthy: rows.filter((r) => r.status === 'HEALTHY').length,
        review: rows.filter((r) => r.status === 'REVIEW').length,
        breach: rows.filter((r) => r.status === 'BREACH').length,
        compliancePercentage:
          rows.length === 0
            ? 100
            : Number(
                ((rows.filter((r) => r.status === 'HEALTHY').length / rows.length) * 100).toFixed(1),
              ),
      },
    });
  }),
);

reportRouter.get(
  '/distribution/:rosterId',
  asyncHandler(async (req, res) => {
    const { input } = await reportContext(pathParam(req, 'rosterId'));
    res.json(distributionReport(input));
  }),
);

reportRouter.get(
  '/compliance/:rosterId',
  asyncHandler(async (req, res) => {
    const { input, leaves } = await reportContext(pathParam(req, 'rosterId'));
    const policy = await getPolicy();
    const validation = validateRoster({ ...input, leaves, policy });
    res.json({ ...complianceReport(validation), issues: validation.issues });
  }),
);
