/** Shared fixtures for the engine test suites. */
import { parseTimeToMinutes } from './dates.js';
import type { EmployeeRecord, Role, ShiftDefinition } from './types.js';

export function makeShift(
  code: string,
  start: string,
  end: string,
  overrides: Partial<ShiftDefinition> = {},
): ShiftDefinition {
  return {
    id: `shift-${code}`,
    code,
    name: `Shift ${code}`,
    startMinutes: parseTimeToMinutes(start),
    endMinutes: parseTimeToMinutes(end),
    minStaff: 3,
    maxStaff: 6,
    shiftLeadsRequired: 1,
    coreResourcesRequired: 1,
    isActive: true,
    ...overrides,
  };
}

/** The default S1/S2/S3 configuration from BRD section 9. */
export const DEFAULT_SHIFTS: ShiftDefinition[] = [
  makeShift('S1', '06:00', '14:00'),
  makeShift('S2', '14:00', '22:00'),
  makeShift('S3', '22:00', '06:00'),
];

export function makeEmployee(
  id: string,
  overrides: Partial<EmployeeRecord> = {},
): EmployeeRecord {
  return {
    id,
    employeeId: id.toUpperCase(),
    name: `Employee ${id}`,
    email: `${id}@example.com`,
    role: 'TEAM_MEMBER',
    teamId: 'team-1',
    locationId: 'loc-blr',
    isCoreResource: false,
    employmentStatus: 'ACTIVE',
    ...overrides,
  };
}

/**
 * Builds a workforce large enough to staff the default shifts for a month:
 * `perShift` groups each containing a lead, a core resource and members.
 */
export function makeWorkforce(count: number): EmployeeRecord[] {
  const employees: EmployeeRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    const index = String(i + 1).padStart(3, '0');
    let role: Role = 'TEAM_MEMBER';
    if (i % 8 === 0) role = 'SHIFT_LEAD';
    else if (i % 8 === 1) role = 'TEAM_LEAD';
    employees.push(
      makeEmployee(`e${index}`, {
        role,
        isCoreResource: i % 5 === 0,
        name: `Employee ${index}`,
      }),
    );
  }
  return employees;
}
