/**
 * Employee master upload (BRD section 7).
 *
 * Accepts XLSX and CSV. The parser is deliberately forgiving about column
 * naming and order — a planner exporting from an HRMS should not have to
 * hand-edit headers — but strict about the mandatory fields, and it reports
 * every problem row rather than stopping at the first one, so a 500-row upload
 * can be fixed in a single pass.
 */
import ExcelJS from 'exceljs';
import { parse as parseCsv } from 'csv-parse/sync';
import { ROLES, type Role } from '@shift-planner/core';
import { badRequest } from '../lib/errors.js';

export interface ParsedEmployeeRow {
  rowNumber: number;
  employeeId: string;
  name: string;
  email: string;
  role: Role;
  team: string;
  manager: string;
  teamLead?: string;
  shiftLead?: string;
  isCoreResource: boolean;
  location?: string;
  skillCategory?: string;
  shiftPreference?: string;
  employmentStatus: 'ACTIVE' | 'INACTIVE';
}

export interface RowError {
  rowNumber: number;
  field: string;
  message: string;
  value?: string;
}

export interface ParseResult {
  rows: ParsedEmployeeRow[];
  errors: RowError[];
  totalRows: number;
}

/** Header aliases, so an HRMS export usually imports without editing. */
const COLUMN_ALIASES: Record<string, string[]> = {
  employeeId: ['employee id', 'employeeid', 'emp id', 'empid', 'employee code', 'id'],
  name: ['employee name', 'name', 'full name', 'employeename'],
  email: ['email address', 'email', 'e-mail', 'mail', 'emailaddress'],
  role: ['role', 'designation', 'user role'],
  team: ['team', 'team name', 'department'],
  manager: ['manager', 'manager name', 'reporting manager'],
  teamLead: ['team lead', 'teamlead', 'tl'],
  shiftLead: ['shift lead', 'shiftlead', 'sl'],
  coreResource: ['core resource', 'coreresource', 'is core', 'core'],
  location: ['location', 'site', 'office'],
  skillCategory: ['skill category', 'skill', 'skillcategory', 'skills'],
  shiftPreference: ['shift preference', 'preferred shift', 'shiftpreference'],
  employmentStatus: ['employment status', 'status', 'employmentstatus'],
};

const normalise = (value: string): string => value.trim().toLowerCase().replace(/[_-]+/g, ' ');

function buildHeaderMap(headers: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headers.forEach((header, index) => {
    const key = normalise(String(header ?? ''));
    if (!key) return;
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (aliases.includes(key) && !map.has(field)) map.set(field, index);
    }
  });
  return map;
}

const TRUTHY = new Set(['yes', 'y', 'true', '1', 'core', 'core resource']);

/** Accepts the role as written in the document, in any casing or spacing. */
function parseRole(raw: string): Role | null {
  const key = normalise(raw).replace(/\s+/g, '_').toUpperCase();
  const direct = ROLES.find((role) => role === key);
  if (direct) return direct;
  const friendly: Record<string, Role> = {
    ADMIN: 'SYSTEM_ADMINISTRATOR',
    ADMINISTRATOR: 'SYSTEM_ADMINISTRATOR',
    SYSTEM_ADMIN: 'SYSTEM_ADMINISTRATOR',
    MEMBER: 'TEAM_MEMBER',
    ASSOCIATE: 'TEAM_MEMBER',
    LEAD: 'TEAM_LEAD',
  };
  return friendly[key] ?? null;
}

async function readGrid(buffer: Buffer, filename: string): Promise<string[][]> {
  const isCsv = filename.toLowerCase().endsWith('.csv');
  if (isCsv) {
    const records = parseCsv(buffer, {
      skip_empty_lines: true,
      relax_column_count: true,
      bom: true,
    }) as string[][];
    return records;
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw badRequest('The uploaded workbook has no sheets');

  const grid: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    // ExcelJS row values are 1-indexed with a leading hole.
    const values = (row.values as unknown[]).slice(1);
    grid.push(
      values.map((cell) => {
        if (cell === null || cell === undefined) return '';
        if (typeof cell === 'object') {
          const rich = cell as { text?: string; result?: unknown; hyperlink?: string };
          if (typeof rich.text === 'string') return rich.text;
          if (rich.result !== undefined) return String(rich.result);
          return '';
        }
        return String(cell);
      }),
    );
  });
  return grid;
}

export async function parseEmployeeUpload(
  buffer: Buffer,
  filename: string,
): Promise<ParseResult> {
  const grid = await readGrid(buffer, filename);
  if (grid.length === 0) throw badRequest('The uploaded file is empty');

  const headers = grid[0] ?? [];
  const headerMap = buildHeaderMap(headers);

  const missingColumns = (['employeeId', 'name', 'email', 'role', 'team', 'manager'] as const).filter(
    (field) => !headerMap.has(field),
  );
  if (missingColumns.length > 0) {
    throw badRequest(
      `The file is missing required column(s): ${missingColumns.join(', ')}. ` +
        'Download the template for the expected format.',
      { missingColumns, detectedHeaders: headers },
    );
  }

  const rows: ParsedEmployeeRow[] = [];
  const errors: RowError[] = [];
  const seenIds = new Map<string, number>();
  const seenEmails = new Map<string, number>();

  const cell = (row: string[], field: string): string => {
    const index = headerMap.get(field);
    if (index === undefined) return '';
    return String(row[index] ?? '').trim();
  };

  for (let i = 1; i < grid.length; i += 1) {
    const row = grid[i];
    if (!row) continue;
    const rowNumber = i + 1; // 1-based, matching what the user sees in Excel.
    if (row.every((value) => String(value ?? '').trim() === '')) continue;

    const employeeId = cell(row, 'employeeId');
    const name = cell(row, 'name');
    const email = cell(row, 'email');
    const roleRaw = cell(row, 'role');
    const team = cell(row, 'team');
    const manager = cell(row, 'manager');

    const rowErrors: RowError[] = [];
    if (!employeeId) rowErrors.push({ rowNumber, field: 'Employee ID', message: 'Required' });
    if (!name) rowErrors.push({ rowNumber, field: 'Employee Name', message: 'Required' });
    if (!email) rowErrors.push({ rowNumber, field: 'Email Address', message: 'Required' });
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      rowErrors.push({ rowNumber, field: 'Email Address', message: 'Not a valid email', value: email });
    }
    if (!team) rowErrors.push({ rowNumber, field: 'Team', message: 'Required' });
    if (!manager) rowErrors.push({ rowNumber, field: 'Manager', message: 'Required' });

    const role = roleRaw ? parseRole(roleRaw) : null;
    if (!roleRaw) rowErrors.push({ rowNumber, field: 'Role', message: 'Required' });
    else if (!role) {
      rowErrors.push({
        rowNumber,
        field: 'Role',
        message: `Unrecognised role. Expected one of: ${ROLES.join(', ')}`,
        value: roleRaw,
      });
    }

    // Duplicates inside the file itself, which the database constraint would
    // otherwise surface as an opaque failure halfway through the import.
    if (employeeId) {
      const first = seenIds.get(employeeId.toLowerCase());
      if (first) {
        rowErrors.push({
          rowNumber,
          field: 'Employee ID',
          message: `Duplicate of row ${first} in this file`,
          value: employeeId,
        });
      } else seenIds.set(employeeId.toLowerCase(), rowNumber);
    }
    if (email) {
      const first = seenEmails.get(email.toLowerCase());
      if (first) {
        rowErrors.push({
          rowNumber,
          field: 'Email Address',
          message: `Duplicate of row ${first} in this file`,
          value: email,
        });
      } else seenEmails.set(email.toLowerCase(), rowNumber);
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }

    const statusRaw = normalise(cell(row, 'employmentStatus'));
    rows.push({
      rowNumber,
      employeeId,
      name,
      email: email.toLowerCase(),
      role: role as Role,
      team,
      manager,
      teamLead: cell(row, 'teamLead') || undefined,
      shiftLead: cell(row, 'shiftLead') || undefined,
      isCoreResource: TRUTHY.has(normalise(cell(row, 'coreResource'))),
      location: cell(row, 'location') || undefined,
      skillCategory: cell(row, 'skillCategory') || undefined,
      shiftPreference: cell(row, 'shiftPreference').toUpperCase() || undefined,
      employmentStatus: statusRaw === 'inactive' ? 'INACTIVE' : 'ACTIVE',
    });
  }

  return { rows, errors, totalRows: grid.length - 1 };
}

/** The downloadable upload template, matching the field table in BRD section 7. */
export async function buildEmployeeTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Shift Planner';
  const sheet = workbook.addWorksheet('Employees');

  sheet.columns = [
    { header: 'Employee ID', key: 'employeeId', width: 16 },
    { header: 'Employee Name', key: 'name', width: 26 },
    { header: 'Email Address', key: 'email', width: 32 },
    { header: 'Role', key: 'role', width: 22 },
    { header: 'Team', key: 'team', width: 20 },
    { header: 'Manager', key: 'manager', width: 22 },
    { header: 'Team Lead', key: 'teamLead', width: 22 },
    { header: 'Shift Lead', key: 'shiftLead', width: 22 },
    { header: 'Core Resource', key: 'coreResource', width: 15 },
    { header: 'Location', key: 'location', width: 16 },
    { header: 'Skill Category', key: 'skillCategory', width: 20 },
    { header: 'Shift Preference', key: 'shiftPreference', width: 18 },
    { header: 'Employment Status', key: 'employmentStatus', width: 18 },
  ];

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F3A5F' },
  };
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.height = 22;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  sheet.addRow({
    employeeId: 'EMP1001',
    name: 'Asha Menon',
    email: 'asha.menon@example.com',
    role: 'SHIFT_LEAD',
    team: 'Network Operations',
    manager: 'Rahul Verma',
    teamLead: 'Priya Nair',
    shiftLead: '',
    coreResource: 'Yes',
    location: 'Bangalore',
    skillCategory: 'Network',
    shiftPreference: 'S1',
    employmentStatus: 'ACTIVE',
  });

  const notes = workbook.addWorksheet('Instructions');
  notes.columns = [
    { header: 'Field', key: 'field', width: 22 },
    { header: 'Mandatory', key: 'mandatory', width: 12 },
    { header: 'Notes', key: 'notes', width: 70 },
  ];
  notes.getRow(1).font = { bold: true };
  const guidance: Array<[string, string, string]> = [
    ['Employee ID', 'Yes', 'Unique across the organisation. Used to match on re-upload.'],
    ['Employee Name', 'Yes', 'Full name as it should appear on the roster.'],
    ['Email Address', 'Yes', 'Unique. Becomes the sign-in identity if a login is created.'],
    ['Role', 'Yes', 'One of SYSTEM_ADMINISTRATOR, MANAGER, SHIFT_LEAD, TEAM_LEAD, TEAM_MEMBER.'],
    ['Team', 'Yes', 'Created automatically if it does not already exist.'],
    ['Manager', 'Yes', 'Name of the reporting manager.'],
    ['Team Lead', 'Optional', 'Name of the team lead.'],
    ['Shift Lead', 'Optional', 'Name of the shift lead.'],
    ['Core Resource', 'Optional', 'Yes or No. Every shift needs at least one core resource.'],
    ['Location', 'Optional', 'Drives which holiday calendar applies to this employee.'],
    ['Skill Category', 'Optional', 'Free text, used when suggesting replacements.'],
    ['Shift Preference', 'Optional', 'A shift code such as S1. Honoured where coverage allows.'],
    ['Employment Status', 'Optional', 'ACTIVE or INACTIVE. Defaults to ACTIVE.'],
  ];
  for (const [field, mandatory, note] of guidance) {
    notes.addRow({ field, mandatory, notes: note });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
