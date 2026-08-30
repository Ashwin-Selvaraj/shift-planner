/**
 * Demo data.
 *
 * Builds a workforce large enough to exercise every rule in the document: three
 * shifts, five locations with their own holiday calendars, planned and pending
 * leave, and enough shift leads and core resources that a generated roster is
 * genuinely publishable rather than trivially empty.
 */
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { DEFAULT_POLICY, parseTimeToMinutes, type Role } from '@shift-planner/core';

const prisma = new PrismaClient();
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'Password123!';

const LOCATIONS = [
  { code: 'BLR', name: 'Bangalore' },
  { code: 'MAA', name: 'Chennai' },
  { code: 'HYD', name: 'Hyderabad' },
  { code: 'PNQ', name: 'Pune' },
  { code: 'BOM', name: 'Mumbai' },
];

/** Default shift configuration from BRD section 9, with capacity from section 10. */
const SHIFTS = [
  {
    code: 'S1',
    name: 'Morning',
    startTime: '06:00 AM',
    endTime: '02:00 PM',
    minStaff: 10,
    maxStaff: 15,
    shiftLeadsRequired: 1,
    coreResourcesRequired: 1,
  },
  {
    code: 'S2',
    name: 'Afternoon',
    startTime: '02:00 PM',
    endTime: '10:00 PM',
    minStaff: 10,
    maxStaff: 15,
    shiftLeadsRequired: 1,
    coreResourcesRequired: 1,
  },
  {
    code: 'S3',
    name: 'Night',
    startTime: '10:00 PM',
    endTime: '06:00 AM',
    minStaff: 10,
    maxStaff: 15,
    shiftLeadsRequired: 1,
    coreResourcesRequired: 1,
  },
];

const TEAMS = [
  { name: 'Network Operations', businessUnit: 'Infrastructure' },
  { name: 'Service Desk', businessUnit: 'Customer Support' },
];

const FIRST_NAMES = [
  'Asha', 'Rahul', 'Priya', 'Vikram', 'Meera', 'Arjun', 'Divya', 'Karthik',
  'Sneha', 'Rohit', 'Ananya', 'Suresh', 'Kavya', 'Nikhil', 'Lakshmi', 'Vivek',
  'Pooja', 'Manish', 'Deepa', 'Sanjay', 'Nisha', 'Aditya', 'Ritu', 'Harish',
  'Swathi', 'Gaurav', 'Neha', 'Prakash', 'Shruti', 'Ajay', 'Tara', 'Kiran',
  'Ishita', 'Varun', 'Anjali', 'Naveen', 'Rekha', 'Sameer', 'Preeti', 'Ravi',
];
const LAST_NAMES = [
  'Menon', 'Verma', 'Nair', 'Iyer', 'Sharma', 'Reddy', 'Patel', 'Rao',
  'Gupta', 'Desai', 'Kulkarni', 'Chandra', 'Bose', 'Pillai', 'Joshi', 'Kapoor',
];

/** Deterministic pseudo-random source, so re-seeding gives the same data. */
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

const HOLIDAYS_2026: Record<string, Array<{ date: string; name: string }>> = {
  BLR: [
    { date: '2026-01-26', name: 'Republic Day' },
    { date: '2026-08-15', name: 'Independence Day' },
    { date: '2026-10-02', name: 'Gandhi Jayanti' },
    { date: '2026-11-01', name: 'Kannada Rajyotsava' },
    { date: '2026-12-25', name: 'Christmas' },
  ],
  MAA: [
    { date: '2026-01-14', name: 'Pongal' },
    { date: '2026-01-26', name: 'Republic Day' },
    { date: '2026-08-15', name: 'Independence Day' },
    { date: '2026-10-02', name: 'Gandhi Jayanti' },
    { date: '2026-12-25', name: 'Christmas' },
  ],
  HYD: [
    { date: '2026-01-26', name: 'Republic Day' },
    { date: '2026-06-02', name: 'Telangana Formation Day' },
    { date: '2026-08-15', name: 'Independence Day' },
    { date: '2026-10-02', name: 'Gandhi Jayanti' },
    { date: '2026-12-25', name: 'Christmas' },
  ],
  PNQ: [
    { date: '2026-01-26', name: 'Republic Day' },
    { date: '2026-05-01', name: 'Maharashtra Day' },
    { date: '2026-08-15', name: 'Independence Day' },
    { date: '2026-10-02', name: 'Gandhi Jayanti' },
    { date: '2026-12-25', name: 'Christmas' },
  ],
  BOM: [
    { date: '2026-01-26', name: 'Republic Day' },
    { date: '2026-05-01', name: 'Maharashtra Day' },
    { date: '2026-08-15', name: 'Independence Day' },
    { date: '2026-10-02', name: 'Gandhi Jayanti' },
    { date: '2026-12-25', name: 'Christmas' },
  ],
};

async function main() {
  console.log('Seeding Shift Planner demo data…');

  // A seed must be repeatable, so previous demo data is cleared first. The
  // order respects foreign keys.
  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.holidayCompensation.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.roster.deleteMany();
  await prisma.leave.deleteMany();
  await prisma.holiday.deleteMany();
  await prisma.employee.updateMany({ data: { managerId: null, teamLeadId: null, shiftLeadId: null } });
  await prisma.team.updateMany({ data: { managerId: null } });
  await prisma.employee.deleteMany();
  await prisma.team.deleteMany();
  await prisma.location.deleteMany();
  await prisma.shift.deleteMany();
  await prisma.user.deleteMany();
  await prisma.policySetting.deleteMany();

  await prisma.policySetting.create({
    data: { id: 'default', json: JSON.stringify(DEFAULT_POLICY) },
  });

  const locations = new Map<string, string>();
  for (const location of LOCATIONS) {
    const row = await prisma.location.create({ data: location });
    locations.set(location.code, row.id);
  }

  for (const [code, holidays] of Object.entries(HOLIDAYS_2026)) {
    const locationId = locations.get(code);
    if (!locationId) continue;
    for (const holiday of holidays) {
      await prisma.holiday.create({ data: { locationId, ...holiday } });
    }
  }

  for (const shift of SHIFTS) {
    const { startTime, endTime, ...rest } = shift;
    await prisma.shift.create({
      data: {
        ...rest,
        startMinutes: parseTimeToMinutes(startTime),
        endMinutes: parseTimeToMinutes(endTime),
        isActive: true,
      },
    });
  }

  const teams = new Map<string, string>();
  for (const team of TEAMS) {
    const row = await prisma.team.create({ data: team });
    teams.set(team.name, row.id);
  }

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);
  const random = makeRandom(20_260_918);
  const locationCodes = LOCATIONS.map((l) => l.code);

  /**
   * Headcount is sized against the capacity plan: three shifts needing ten
   * people each, every day, with weekly offs and leave on top. Fifty per team
   * leaves enough slack for the engine to honour the wellness rules.
   */
  const PER_TEAM = 50;
  let counter = 0;
  const createdEmployees: Array<{ id: string; name: string; role: Role; teamName: string }> = [];

  for (const [teamName, teamId] of teams) {
    for (let i = 0; i < PER_TEAM; i += 1) {
      counter += 1;
      const first = FIRST_NAMES[counter % FIRST_NAMES.length] as string;
      const last = LAST_NAMES[(counter * 7) % LAST_NAMES.length] as string;
      const name = `${first} ${last}`;

      // One manager per team, then roughly one lead per eight people so every
      // shift can be staffed on every day of the month.
      let role: Role = 'TEAM_MEMBER';
      if (i === 0) role = 'MANAGER';
      else if (i % 5 === 1) role = 'SHIFT_LEAD';
      else if (i % 11 === 3) role = 'TEAM_LEAD';

      const employee = await prisma.employee.create({
        data: {
          employeeId: `EMP${String(1000 + counter)}`,
          name,
          email: `${first.toLowerCase()}.${last.toLowerCase()}${counter}@example.com`,
          role,
          teamId,
          locationId: locations.get(locationCodes[counter % locationCodes.length] as string) ?? null,
          isCoreResource: i % 4 === 2,
          skillCategory: ['Network', 'Voice', 'Database', 'Applications'][counter % 4] as string,
          shiftPreference: random() > 0.6 ? (['S1', 'S2', 'S3'][counter % 3] as string) : null,
          employmentStatus: 'ACTIVE',
        },
      });
      createdEmployees.push({ id: employee.id, name, role, teamName });
    }
  }

  // Reporting lines and team ownership.
  for (const [teamName, teamId] of teams) {
    const teamPeople = createdEmployees.filter((e) => e.teamName === teamName);
    const manager = teamPeople.find((e) => e.role === 'MANAGER');
    const leads = teamPeople.filter((e) => e.role === 'SHIFT_LEAD');
    const teamLeads = teamPeople.filter((e) => e.role === 'TEAM_LEAD');
    if (!manager) continue;

    await prisma.team.update({ where: { id: teamId }, data: { managerId: manager.id } });
    for (const [index, person] of teamPeople.entries()) {
      if (person.id === manager.id) continue;
      await prisma.employee.update({
        where: { id: person.id },
        data: {
          managerId: manager.id,
          teamLeadId: teamLeads.length ? (teamLeads[index % teamLeads.length]?.id ?? null) : null,
          shiftLeadId: leads.length ? (leads[index % leads.length]?.id ?? null) : null,
        },
      });
    }
  }

  /**
   * Logins. One account per role so every permission set in BRD section 6 can
   * be exercised, plus real accounts for the two team managers.
   */
  const demoAccounts: Array<{ email: string; name: string; role: Role; employeeName?: string }> = [
    { email: 'admin@shiftplanner.app', name: 'System Administrator', role: 'SYSTEM_ADMINISTRATOR' },
  ];

  for (const [teamName] of teams) {
    const teamPeople = createdEmployees.filter((e) => e.teamName === teamName);
    const manager = teamPeople.find((e) => e.role === 'MANAGER');
    const shiftLead = teamPeople.find((e) => e.role === 'SHIFT_LEAD');
    const teamLead = teamPeople.find((e) => e.role === 'TEAM_LEAD');
    const member = teamPeople.find((e) => e.role === 'TEAM_MEMBER');
    for (const person of [manager, shiftLead, teamLead, member]) {
      if (!person) continue;
      demoAccounts.push({
        email: '',
        name: person.name,
        role: person.role,
        employeeName: person.name,
      });
    }
  }

  await prisma.user.create({
    data: {
      email: 'admin@shiftplanner.app',
      name: 'System Administrator',
      role: 'SYSTEM_ADMINISTRATOR',
      passwordHash,
    },
  });

  const signInAccounts: Array<{ email: string; role: string; name: string }> = [
    { email: 'admin@shiftplanner.app', role: 'SYSTEM_ADMINISTRATOR', name: 'System Administrator' },
  ];

  // Give the first person of each role in each team a working login, using a
  // predictable address so the README can list them.
  const roleSlug: Record<string, string> = {
    MANAGER: 'manager',
    SHIFT_LEAD: 'shiftlead',
    TEAM_LEAD: 'teamlead',
    TEAM_MEMBER: 'member',
  };
  let teamIndex = 0;
  for (const [teamName] of teams) {
    teamIndex += 1;
    const teamPeople = createdEmployees.filter((e) => e.teamName === teamName);
    for (const role of ['MANAGER', 'SHIFT_LEAD', 'TEAM_LEAD', 'TEAM_MEMBER'] as const) {
      const person = teamPeople.find((e) => e.role === role);
      if (!person) continue;
      const email = `${roleSlug[role]}${teamIndex}@shiftplanner.app`;
      const user = await prisma.user.create({
        data: { email, name: person.name, role, passwordHash },
      });
      await prisma.employee.update({ where: { id: person.id }, data: { userId: user.id } });
      signInAccounts.push({ email, role, name: person.name });
    }
  }

  // Leave: a mix of approved planned leave and pending requests so the
  // approval workflow and the leave-conflict rule both have something to act on.
  const leaveCandidates = createdEmployees.filter((e) => e.role === 'TEAM_MEMBER').slice(0, 14);
  for (const [index, person] of leaveCandidates.entries()) {
    const startDay = 4 + ((index * 3) % 20);
    const start = `2026-09-${String(startDay).padStart(2, '0')}`;
    const end = `2026-09-${String(Math.min(30, startDay + (index % 3))).padStart(2, '0')}`;
    await prisma.leave.create({
      data: {
        employeeId: person.id,
        startDate: start,
        endDate: end,
        kind: index % 5 === 0 ? 'EMERGENCY' : 'PLANNED',
        status: index % 4 === 0 ? 'PENDING' : 'APPROVED',
        reason: index % 5 === 0 ? 'Family emergency' : 'Planned time off',
      },
    });
  }

  console.log('\nSeed complete.');
  console.log(`  Locations       ${LOCATIONS.length}`);
  console.log(`  Shifts          ${SHIFTS.length}`);
  console.log(`  Teams           ${TEAMS.length}`);
  console.log(`  Employees       ${createdEmployees.length}`);
  console.log(`  Leave records   ${leaveCandidates.length}`);
  console.log('\nSign in with any of these accounts:');
  for (const account of signInAccounts) {
    console.log(`  ${account.email.padEnd(32)} ${account.role.padEnd(22)} ${account.name}`);
  }
  console.log(`\n  Password for every account: ${SEED_PASSWORD}\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
