/**
 * Shift Planner — shared domain types.
 *
 * These types are the contract between the scheduling engines, the API and the
 * web client. They intentionally mirror the entities described in the BRD/FRD
 * (sections 7-25) rather than the database schema, so the engines stay pure and
 * independently testable.
 */

/** Hierarchy roles from BRD section 6 (User Roles & Permissions). */
export const ROLES = [
  'SYSTEM_ADMINISTRATOR',
  'MANAGER',
  'SHIFT_LEAD',
  'TEAM_LEAD',
  'TEAM_MEMBER',
] as const;
export type Role = (typeof ROLES)[number];

export type EmploymentStatus = 'ACTIVE' | 'INACTIVE';

/** What an employee is doing on a given calendar day. BRD section 12 legend. */
export type AssignmentType = 'SHIFT' | 'OFF' | 'LEAVE' | 'HOLIDAY';

export type LeaveKind = 'PLANNED' | 'EMERGENCY';
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

/** BRD section 23 — an employee working a holiday picks exactly one. */
export type HolidayCompensationChoice = 'COMP_OFF' | 'DOUBLE_PAY';

export type RosterStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'ARCHIVED';

/**
 * A shift definition plus its capacity plan (BRD sections 9 and 10).
 *
 * Times are stored as minutes from midnight so that overnight shifts
 * (`endMinutes <= startMinutes`) and rest-period arithmetic are unambiguous and
 * timezone-free.
 */
export interface ShiftDefinition {
  id: string;
  code: string;
  name: string;
  startMinutes: number;
  endMinutes: number;
  minStaff: number;
  maxStaff: number;
  shiftLeadsRequired: number;
  coreResourcesRequired: number;
  isActive: boolean;
}

/** Employee master record (BRD section 7). */
export interface EmployeeRecord {
  id: string;
  employeeId: string;
  name: string;
  email: string;
  role: Role;
  teamId: string;
  managerId?: string | null;
  teamLeadId?: string | null;
  shiftLeadId?: string | null;
  locationId?: string | null;
  /** BRD section 13 — core resources are the people a shift cannot run without. */
  isCoreResource: boolean;
  skillCategory?: string | null;
  /** Preferred shift code, honoured as a soft objective by the roster engine. */
  shiftPreference?: string | null;
  employmentStatus: EmploymentStatus;
}

/** One employee, one calendar day. BRD section 15 permits only one per day. */
export interface AssignmentRecord {
  id?: string;
  employeeId: string;
  /** ISO calendar date, `YYYY-MM-DD`. */
  date: string;
  type: AssignmentType;
  shiftId?: string | null;
  /**
   * BRD section 17 — restricted shift transitions are only legal when a manager
   * has explicitly overridden them.
   */
  overrideReason?: string | null;
  overrideBy?: string | null;
  /** Manual edits are locked so regeneration does not silently undo a planner. */
  locked?: boolean;
}

export interface LeaveRecord {
  id: string;
  employeeId: string;
  /** Inclusive ISO date range. */
  startDate: string;
  endDate: string;
  kind: LeaveKind;
  status: LeaveStatus;
  reason?: string | null;
}

export interface HolidayRecord {
  id: string;
  locationId: string;
  date: string;
  name: string;
}

export interface LocationRecord {
  id: string;
  code: string;
  name: string;
}

export interface TeamRecord {
  id: string;
  name: string;
  businessUnit?: string | null;
  managerId?: string | null;
}
