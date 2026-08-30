/** Shapes returned by the API, mirrored for the client. */
import type { Role, ValidationResult } from '@shift-planner/core';

export type { Role, ValidationResult };

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  employeeId?: string | null;
  teamId?: string | null;
  permissions: string[];
}

export interface Team {
  id: string;
  name: string;
  businessUnit?: string | null;
  manager?: { id: string; name: string } | null;
  _count?: { employees: number };
}

export interface Location {
  id: string;
  code: string;
  name: string;
  _count?: { employees: number; holidays: number };
}

export interface Shift {
  id: string;
  code: string;
  name: string;
  startMinutes: number;
  endMinutes: number;
  startTime: string;
  endTime: string;
  minStaff: number;
  maxStaff: number;
  shiftLeadsRequired: number;
  coreResourcesRequired: number;
  isActive: boolean;
}

export interface Employee {
  id: string;
  employeeId: string;
  name: string;
  email: string;
  role: Role;
  teamId: string;
  locationId?: string | null;
  isCoreResource: boolean;
  skillCategory?: string | null;
  shiftPreference?: string | null;
  employmentStatus: 'ACTIVE' | 'INACTIVE';
  team?: { id: string; name: string };
  location?: { id: string; name: string; code: string } | null;
}

export type AssignmentType = 'SHIFT' | 'OFF' | 'LEAVE' | 'HOLIDAY';

export interface Assignment {
  id: string;
  employeeId: string;
  date: string;
  type: AssignmentType;
  shiftId?: string | null;
  overrideReason?: string | null;
  locked: boolean;
  shift?: { id: string; code: string; name: string } | null;
}

export type RosterStatus = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED';

export interface RosterSummary {
  id: string;
  teamId: string;
  year: number;
  month: number;
  startDate: string;
  endDate: string;
  status: RosterStatus;
  label: string;
  team?: { id: string; name: string };
  validation?: ValidationResult | null;
  _count?: { assignments: number };
}

export interface RosterDetail extends RosterSummary {
  assignments: Assignment[];
  employees: Array<
    Pick<
      Employee,
      'id' | 'employeeId' | 'name' | 'role' | 'isCoreResource' | 'shiftPreference' | 'locationId'
    > & { employmentStatus: 'ACTIVE' | 'INACTIVE' }
  >;
}

export interface Leave {
  id: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  kind: 'PLANNED' | 'EMERGENCY';
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  reason?: string | null;
  employee?: { id: string; name: string; employeeId: string };
  replacement?: { id: string; name: string; employeeId: string } | null;
}

export interface Holiday {
  id: string;
  locationId: string;
  date: string;
  name: string;
  location?: { id: string; name: string; code: string };
}

export interface DashboardResponse {
  date: string;
  hasRosterForToday: boolean;
  metrics: {
    totalEmployees: number;
    activeEmployees: number;
    scheduledToday: number;
    onLeaveToday: number;
    openPositions: number | null;
    coveragePercentage: number | null;
    shiftLeadCoverage: number | null;
    coreResourceCoverage: number | null;
    pendingLeaveRequests: number;
  };
  coverageByShift: Array<{
    shiftCode: string;
    required: number;
    assigned: number;
    maxStaff: number;
    shiftLeadsAssigned: number;
    shiftLeadsRequired: number;
    coreAssigned: number;
    coreRequired: number;
    status: string;
  }>;
  recentRosters: Array<{
    id: string;
    team: string;
    label: string;
    status: RosterStatus;
    validation?: ValidationResult | null;
  }>;
  teams: Array<{ id: string; name: string }>;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  link?: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  userName: string;
  action: string;
  entity: string;
  entityId?: string | null;
  previousValue?: string | null;
  updatedValue?: string | null;
  reason?: string | null;
  createdAt: string;
}
