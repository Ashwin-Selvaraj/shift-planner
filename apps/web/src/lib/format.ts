/** Presentation helpers shared across pages. */
import type { AssignmentType, Role, RosterStatus } from './types';

export const ROLE_LABELS: Record<Role, string> = {
  SYSTEM_ADMINISTRATOR: 'System Administrator',
  MANAGER: 'Manager',
  SHIFT_LEAD: 'Shift Lead',
  TEAM_LEAD: 'Team Lead',
  TEAM_MEMBER: 'Team Member',
};

export const STATUS_STYLES: Record<RosterStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  PENDING_APPROVAL: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-sky-100 text-sky-800',
  PUBLISHED: 'bg-emerald-100 text-emerald-800',
  ARCHIVED: 'bg-slate-100 text-slate-500',
};

export const statusLabel = (status: RosterStatus): string =>
  status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Legend colours from BRD section 12. */
export function cellStyle(type: AssignmentType, shiftCode?: string): string {
  if (type === 'LEAVE') return 'bg-rose-100 text-rose-700 border-rose-200';
  if (type === 'HOLIDAY') return 'bg-violet-100 text-violet-700 border-violet-200';
  if (type === 'OFF') return 'bg-slate-100 text-slate-500 border-slate-200';
  switch (shiftCode) {
    case 'S1':
      return 'bg-cyan-100 text-cyan-800 border-cyan-200';
    case 'S2':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'S3':
      return 'bg-violet-100 text-violet-800 border-violet-200';
    default:
      return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  }
}

export function cellLabel(type: AssignmentType, shiftCode?: string): string {
  if (type === 'SHIFT') return shiftCode ?? '—';
  if (type === 'OFF') return 'O';
  if (type === 'LEAVE') return 'L';
  return 'H';
}

const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function shortDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  return WEEKDAY[day === 0 ? 6 : day - 1] ?? '';
}

export function dayOfMonth(date: string): string {
  return date.slice(8, 10);
}

export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Turns a validation code into something a planner can act on. */
export const ISSUE_LABELS: Record<string, string> = {
  MISSING_SHIFT_LEAD: 'Missing shift lead',
  MISSING_CORE_RESOURCE: 'Missing core resource',
  LEAVE_CONFLICT: 'Assigned while on leave',
  DUPLICATE_SHIFT_ASSIGNMENT: 'Two shifts in one day',
  SEVEN_DAY_STREAK: 'Seven day work streak',
  CAPACITY_BELOW_MINIMUM: 'Below minimum staffing',
  CAPACITY_ABOVE_MAXIMUM: 'Above maximum staffing',
  MISSING_WEEKLY_OFF: 'No weekly rest day',
  RESTRICTED_TRANSITION: 'Restricted shift transition',
  INACTIVE_EMPLOYEE_ASSIGNED: 'Inactive employee rostered',
  UNEVEN_DISTRIBUTION: 'Uneven workload',
  EXCESSIVE_SHIFT_ROTATION: 'Excessive shift rotation',
  SIX_DAY_CONSECUTIVE: 'Six consecutive days',
  INSUFFICIENT_REST: 'Short rest between shifts',
  OVERRIDDEN_TRANSITION: 'Override applied',
};
