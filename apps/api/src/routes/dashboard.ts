/** Dashboard metrics (BRD section 11). */
import { Router } from 'express';
import { coverageReport, monthLabel, toISODate } from '@shift-planner/core';
import { asyncHandler } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import {
  toAssignmentRecord,
  toEmployeeRecord,
  toHolidayRecord,
  toShiftDefinition,
} from '../lib/mappers.js';

export const dashboardRouter = Router();
dashboardRouter.use(authenticate, requirePermission('dashboard:read'));

dashboardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const today = toISODate(new Date());
    const teamId = req.query.teamId ? String(req.query.teamId) : undefined;
    const scope = teamId ? { teamId } : {};

    const [totalEmployees, activeEmployees, shifts, onLeaveToday, teams] = await Promise.all([
      prisma.employee.count({ where: scope }),
      prisma.employee.count({ where: { ...scope, employmentStatus: 'ACTIVE' } }),
      prisma.shift.findMany({ where: { isActive: true } }),
      prisma.leave.count({
        where: {
          status: 'APPROVED',
          startDate: { lte: today },
          endDate: { gte: today },
          ...(teamId ? { employee: { teamId } } : {}),
        },
      }),
      prisma.team.findMany({ select: { id: true, name: true } }),
    ]);

    // "Scheduled" and the coverage figures are measured against today's live
    // roster, which is what a planner is actually looking at.
    const todaysAssignments = await prisma.assignment.findMany({
      where: {
        date: today,
        ...(teamId ? { employee: { teamId } } : {}),
        roster: { status: { in: ['PUBLISHED', 'APPROVED', 'PENDING_APPROVAL', 'DRAFT'] } },
      },
      include: {
        employee: { select: { id: true, role: true, isCoreResource: true, teamId: true } },
      },
    });

    const scheduledToday = todaysAssignments.filter((a) => a.type === 'SHIFT').length;

    // If no roster covers today, every coverage figure below is trivially zero.
    // Reporting that as "0% coverage, 30 open positions" reads like an
    // operational emergency when the real situation is simply that nothing has
    // been planned yet, so the state is surfaced explicitly instead.
    const hasRosterForToday = todaysAssignments.length > 0;

    const employees = await prisma.employee.findMany({ where: scope });
    const holidays = await prisma.holiday.findMany({ where: { date: today } });

    const coverage = coverageReport({
      startDate: today,
      endDate: today,
      employees: employees.map(toEmployeeRecord),
      shifts: shifts.map(toShiftDefinition),
      assignments: todaysAssignments.map(toAssignmentRecord),
      holidays: holidays.map(toHolidayRecord),
    });

    const requiredToday = coverage.reduce((sum, row) => sum + row.required, 0);
    const assignedToday = coverage.reduce((sum, row) => sum + row.assigned, 0);
    const leadsRequired = coverage.reduce((sum, row) => sum + row.shiftLeadsRequired, 0);
    const leadsAssigned = coverage.reduce((sum, row) => sum + row.shiftLeadsAssigned, 0);
    const coreRequired = coverage.reduce((sum, row) => sum + row.coreRequired, 0);
    const coreAssigned = coverage.reduce((sum, row) => sum + row.coreAssigned, 0);

    const pct = (assigned: number, required: number) =>
      required === 0 ? 100 : Number(((Math.min(assigned, required) / required) * 100).toFixed(1));

    const rosters = await prisma.roster.findMany({
      where: scope,
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      take: 6,
      include: { team: { select: { name: true } } },
    });

    const pendingLeaves = await prisma.leave.count({
      where: { status: 'PENDING', ...(teamId ? { employee: { teamId } } : {}) },
    });

    res.json({
      date: today,
      hasRosterForToday,
      metrics: {
        totalEmployees,
        activeEmployees,
        scheduledToday,
        onLeaveToday,
        // "Open positions" is the shortfall against today's minimum staffing.
        openPositions: hasRosterForToday ? Math.max(0, requiredToday - assignedToday) : null,
        coveragePercentage: hasRosterForToday ? pct(assignedToday, requiredToday) : null,
        shiftLeadCoverage: hasRosterForToday ? pct(leadsAssigned, leadsRequired) : null,
        coreResourceCoverage: hasRosterForToday ? pct(coreAssigned, coreRequired) : null,
        pendingLeaveRequests: pendingLeaves,
      },
      coverageByShift: coverage.map((row) => ({
        shiftCode: row.shiftCode,
        required: row.required,
        assigned: row.assigned,
        maxStaff: row.maxStaff,
        shiftLeadsAssigned: row.shiftLeadsAssigned,
        shiftLeadsRequired: row.shiftLeadsRequired,
        coreAssigned: row.coreAssigned,
        coreRequired: row.coreRequired,
        status: row.status,
      })),
      recentRosters: rosters.map((roster) => ({
        id: roster.id,
        team: roster.team.name,
        label: monthLabel(roster.year, roster.month),
        status: roster.status,
        validation: roster.validationJson ? JSON.parse(roster.validationJson) : null,
      })),
      teams,
    });
  }),
);
