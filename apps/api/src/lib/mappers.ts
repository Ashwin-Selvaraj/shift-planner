/**
 * Translation between Prisma rows and the plain domain records the engines in
 * `@shift-planner/core` operate on. Keeping the boundary explicit means the
 * engines never see a database type and stay unit-testable.
 */
import type {
  AssignmentRecord,
  AssignmentType,
  EmployeeRecord,
  HolidayRecord,
  LeaveKind,
  LeaveRecord,
  LeaveStatus,
  Role,
  ShiftDefinition,
} from '@shift-planner/core';
import type { Assignment, Employee, Holiday, Leave, Shift } from '@prisma/client';

export function toEmployeeRecord(row: Employee): EmployeeRecord {
  return {
    id: row.id,
    employeeId: row.employeeId,
    name: row.name,
    email: row.email,
    role: row.role as Role,
    teamId: row.teamId,
    managerId: row.managerId,
    teamLeadId: row.teamLeadId,
    shiftLeadId: row.shiftLeadId,
    locationId: row.locationId,
    isCoreResource: row.isCoreResource,
    skillCategory: row.skillCategory,
    shiftPreference: row.shiftPreference,
    employmentStatus: row.employmentStatus === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
  };
}

export function toShiftDefinition(row: Shift): ShiftDefinition {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    startMinutes: row.startMinutes,
    endMinutes: row.endMinutes,
    minStaff: row.minStaff,
    maxStaff: row.maxStaff,
    shiftLeadsRequired: row.shiftLeadsRequired,
    coreResourcesRequired: row.coreResourcesRequired,
    isActive: row.isActive,
  };
}

export function toAssignmentRecord(row: Assignment): AssignmentRecord {
  return {
    id: row.id,
    employeeId: row.employeeId,
    date: row.date,
    type: row.type as AssignmentType,
    shiftId: row.shiftId,
    overrideReason: row.overrideReason,
    overrideBy: row.overrideBy,
    locked: row.locked,
  };
}

export function toLeaveRecord(row: Leave): LeaveRecord {
  return {
    id: row.id,
    employeeId: row.employeeId,
    startDate: row.startDate,
    endDate: row.endDate,
    kind: row.kind as LeaveKind,
    status: row.status as LeaveStatus,
    reason: row.reason,
  };
}

export function toHolidayRecord(row: Holiday): HolidayRecord {
  return {
    id: row.id,
    locationId: row.locationId,
    date: row.date,
    name: row.name,
  };
}
