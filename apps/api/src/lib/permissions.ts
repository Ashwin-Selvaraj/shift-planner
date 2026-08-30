/**
 * Role-based access control (BRD section 6).
 *
 * Permissions are named after the action, not the route, so a route can require
 * exactly the capability the document grants and nothing broader.
 */
import type { Role } from '@shift-planner/core';

export const PERMISSIONS = [
  'dashboard:read',
  'employee:read',
  'employee:write',
  'employee:upload',
  'team:read',
  'team:write',
  'shift:read',
  'shift:write',
  'location:write',
  'holiday:read',
  'holiday:write',
  'roster:read',
  'roster:read:all',
  'roster:write',
  'roster:generate',
  'roster:approve',
  'roster:publish',
  'leave:read',
  'leave:request',
  'leave:approve',
  'report:read',
  'audit:read',
  'settings:write',
  'notification:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Notes on the two places the document leaves room for interpretation:
 *
 * - Team Lead "Planning Support" (BRD 6) is granted as read access to the whole
 *   team roster plus the ability to raise leave requests. The document is
 *   explicit that a team lead cannot upload employees or publish a roster, so
 *   the grant stays deliberately narrow; widen it here if the business wants
 *   team leads editing draft assignments.
 * - Shift Lead has no approval rights. The document lists roster approval and
 *   publication under Manager, and bars shift leads from configuration changes.
 */
const MATRIX: Record<Role, Permission[]> = {
  SYSTEM_ADMINISTRATOR: [...PERMISSIONS],

  MANAGER: [
    'dashboard:read',
    'employee:read',
    'employee:write',
    'employee:upload',
    'team:read',
    'team:write',
    'shift:read',
    'holiday:read',
    'roster:read',
    'roster:read:all',
    'roster:write',
    'roster:generate',
    'roster:approve',
    'roster:publish',
    'leave:read',
    'leave:request',
    'leave:approve',
    'report:read',
    'audit:read',
    'notification:read',
  ],

  SHIFT_LEAD: [
    'dashboard:read',
    'employee:read',
    'team:read',
    'shift:read',
    'holiday:read',
    'roster:read',
    'roster:read:all',
    'roster:write',
    'roster:generate',
    'leave:read',
    'leave:request',
    'report:read',
    'notification:read',
  ],

  TEAM_LEAD: [
    'dashboard:read',
    'employee:read',
    'team:read',
    'shift:read',
    'holiday:read',
    'roster:read',
    'roster:read:all',
    'leave:read',
    'leave:request',
    'report:read',
    'notification:read',
  ],

  TEAM_MEMBER: [
    'roster:read',
    'holiday:read',
    'leave:request',
    'notification:read',
    'shift:read',
  ],
};

export function permissionsFor(role: Role): Permission[] {
  return MATRIX[role] ?? [];
}

export function can(role: Role, permission: Permission): boolean {
  return permissionsFor(role).includes(permission);
}
