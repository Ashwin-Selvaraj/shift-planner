import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, getToken } from '../lib/api';
import { useSession } from '../hooks/useSession';
import { EmptyState, ErrorNotice, Modal, PageHeader, Spinner, Toast } from '../components/ui';
import { ROLE_LABELS } from '../lib/format';
import type { Employee, Location, Team } from '../lib/types';

interface UploadResult {
  applied: boolean;
  totalRows: number;
  created?: number;
  updated?: number;
  validRows?: number;
  message: string;
  errors: Array<{ rowNumber: number; field: string; message: string; value?: string }>;
}

/** Employee master management and bulk upload (BRD section 7). */
export function Employees() {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  const employeesQuery = useQuery({
    queryKey: ['employees'],
    queryFn: () => api<Employee[]>('/employees'),
  });
  const teamsQuery = useQuery({ queryKey: ['teams'], queryFn: () => api<Team[]>('/config/teams') });
  const locationsQuery = useQuery({
    queryKey: ['locations'],
    queryFn: () => api<Location[]>('/config/locations'),
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (employeesQuery.data ?? []).filter((employee) => {
      if (teamFilter && employee.teamId !== teamFilter) return false;
      if (roleFilter && employee.role !== roleFilter) return false;
      if (!term) return true;
      return (
        employee.name.toLowerCase().includes(term) ||
        employee.employeeId.toLowerCase().includes(term) ||
        employee.email.toLowerCase().includes(term)
      );
    });
  }, [employeesQuery.data, search, teamFilter, roleFilter]);

  const upload = useMutation({
    mutationFn: async ({ file, dryRun }: { file: File; dryRun: boolean }) => {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch(`/api/employees/upload?dryRun=${dryRun}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken() ?? ''}` },
        body,
      });
      const payload = (await response.json()) as UploadResult & { error?: string };
      // A 422 is a valid, expected outcome here: it carries the per-row report
      // the planner needs, so it is rendered rather than thrown away.
      if (!response.ok && response.status !== 422) {
        throw new Error(payload.error ?? 'Upload failed');
      }
      return payload;
    },
    onSuccess: (result) => {
      setUploadResult(result);
      if (result.applied) {
        queryClient.invalidateQueries({ queryKey: ['employees'] });
        setToast({ message: result.message, tone: 'success' });
      }
    },
    onError: (caught) =>
      setToast({ message: caught instanceof Error ? caught.message : 'Upload failed', tone: 'error' }),
  });

  async function downloadTemplate() {
    try {
      const response = await api<Response>('/employees/template', { raw: true });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'employee-upload-template.xlsx';
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setToast({ message: 'Could not download the template', tone: 'error' });
    }
  }

  if (employeesQuery.isLoading) return <Spinner label="Loading employees" />;
  if (employeesQuery.error) {
    return <ErrorNotice error={employeesQuery.error} onRetry={employeesQuery.refetch} />;
  }

  return (
    <>
      <PageHeader
        title="Employees"
        description={`${filtered.length} of ${employeesQuery.data?.length ?? 0} shown`}
        actions={
          <>
            {can('employee:upload') ? (
              <>
                <button type="button" className="btn-secondary" onClick={downloadTemplate}>
                  Download template
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setUploadResult(null);
                    setUploadOpen(true);
                  }}
                >
                  Upload
                </button>
              </>
            ) : null}
            {can('employee:write') ? (
              <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
                Add employee
              </button>
            ) : null}
          </>
        }
      />

      <div className="card mb-4 flex flex-wrap gap-3 px-4 py-3">
        <input
          className="input max-w-xs"
          placeholder="Search name, ID or email…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search employees"
        />
        <select
          className="input w-auto"
          value={teamFilter}
          onChange={(event) => setTeamFilter(event.target.value)}
          aria-label="Filter by team"
        >
          <option value="">All teams</option>
          {(teamsQuery.data ?? []).map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
        <select
          className="input w-auto"
          value={roleFilter}
          onChange={(event) => setRoleFilter(event.target.value)}
          aria-label="Filter by role"
        >
          <option value="">All roles</option>
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No employees match your filters" />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto thin-scroll">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Employee</th>
                  <th className="th">Role</th>
                  <th className="th">Team</th>
                  <th className="th">Location</th>
                  <th className="th">Core</th>
                  <th className="th">Preference</th>
                  <th className="th">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((employee) => (
                  <tr key={employee.id} className="hover:bg-slate-50">
                    <td className="td">
                      <p className="font-medium text-slate-800">{employee.name}</p>
                      <p className="text-xs text-slate-500">
                        {employee.employeeId} · {employee.email}
                      </p>
                    </td>
                    <td className="td">{ROLE_LABELS[employee.role]}</td>
                    <td className="td">{employee.team?.name ?? '—'}</td>
                    <td className="td">{employee.location?.name ?? '—'}</td>
                    <td className="td">
                      {employee.isCoreResource ? (
                        <span className="badge bg-sky-100 text-sky-700">Core</span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="td">{employee.shiftPreference ?? '—'}</td>
                    <td className="td">
                      <span
                        className={`badge ${
                          employee.employmentStatus === 'ACTIVE'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {employee.employmentStatus === 'ACTIVE' ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {uploadOpen ? (
        <Modal
          title="Upload employee master"
          onClose={() => setUploadOpen(false)}
          footer={
            <button type="button" className="btn-secondary" onClick={() => setUploadOpen(false)}>
              Close
            </button>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Accepts <strong>.xlsx</strong> and <strong>.csv</strong>. The whole file is checked
              before anything is saved — if any row is invalid, nothing is imported and every
              problem is listed below, so you can fix them in one pass.
            </p>

            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.csv"
              className="input"
              aria-label="Choose a file"
            />

            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={upload.isPending}
                onClick={() => {
                  const file = fileInput.current?.files?.[0];
                  if (file) upload.mutate({ file, dryRun: true });
                }}
              >
                Validate only
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={upload.isPending}
                onClick={() => {
                  const file = fileInput.current?.files?.[0];
                  if (file) upload.mutate({ file, dryRun: false });
                }}
              >
                {upload.isPending ? 'Uploading…' : 'Import'}
              </button>
            </div>

            {uploadResult ? (
              <div
                className={`rounded-lg px-3 py-2 text-sm ${
                  uploadResult.errors.length > 0
                    ? 'bg-rose-50 text-rose-800'
                    : 'bg-emerald-50 text-emerald-800'
                }`}
              >
                <p className="font-medium">{uploadResult.message}</p>
                {uploadResult.errors.length > 0 ? (
                  <div className="mt-2 max-h-52 overflow-y-auto thin-scroll">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left">
                          <th className="py-1 pr-2">Row</th>
                          <th className="py-1 pr-2">Field</th>
                          <th className="py-1">Problem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {uploadResult.errors.slice(0, 100).map((issue, index) => (
                          <tr key={`${issue.rowNumber}-${issue.field}-${index}`}>
                            <td className="py-0.5 pr-2 tabular-nums">{issue.rowNumber}</td>
                            <td className="py-0.5 pr-2">{issue.field}</td>
                            <td className="py-0.5">
                              {issue.message}
                              {issue.value ? ` — "${issue.value}"` : ''}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {createOpen ? (
        <CreateEmployeeModal
          teams={teamsQuery.data ?? []}
          locations={locationsQuery.data ?? []}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            queryClient.invalidateQueries({ queryKey: ['employees'] });
            setToast({ message: 'Employee added.', tone: 'success' });
          }}
          onError={(message) => setToast({ message, tone: 'error' })}
        />
      ) : null}

      {toast ? <Toast {...toast} onDismiss={() => setToast(null)} /> : null}
    </>
  );
}

function CreateEmployeeModal({
  teams,
  locations,
  onClose,
  onCreated,
  onError,
}: {
  teams: Team[];
  locations: Location[];
  onClose: () => void;
  onCreated: () => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({
    employeeId: '',
    name: '',
    email: '',
    role: 'TEAM_MEMBER',
    teamId: teams[0]?.id ?? '',
    locationId: '',
    isCoreResource: false,
    shiftPreference: '',
    skillCategory: '',
  });

  const create = useMutation({
    mutationFn: () =>
      api('/employees', {
        method: 'POST',
        body: {
          ...form,
          locationId: form.locationId || null,
          shiftPreference: form.shiftPreference || null,
          skillCategory: form.skillCategory || null,
        },
      }),
    onSuccess: onCreated,
    onError: (caught) => onError(caught instanceof Error ? caught.message : 'Could not add employee'),
  });

  const valid = form.employeeId && form.name && form.email && form.teamId;

  return (
    <Modal
      title="Add employee"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!valid || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Saving…' : 'Add employee'}
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="emp-id">
            Employee ID *
          </label>
          <input
            id="emp-id"
            className="input"
            value={form.employeeId}
            onChange={(event) => setForm({ ...form, employeeId: event.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="emp-name">
            Name *
          </label>
          <input
            id="emp-name"
            className="input"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="emp-email">
            Email *
          </label>
          <input
            id="emp-email"
            type="email"
            className="input"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="emp-role">
            Role *
          </label>
          <select
            id="emp-role"
            className="input"
            value={form.role}
            onChange={(event) => setForm({ ...form, role: event.target.value })}
          >
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="emp-team">
            Team *
          </label>
          <select
            id="emp-team"
            className="input"
            value={form.teamId}
            onChange={(event) => setForm({ ...form, teamId: event.target.value })}
          >
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="emp-location">
            Location
          </label>
          <select
            id="emp-location"
            className="input"
            value={form.locationId}
            onChange={(event) => setForm({ ...form, locationId: event.target.value })}
          >
            <option value="">None</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="emp-pref">
            Shift preference
          </label>
          <input
            id="emp-pref"
            className="input"
            placeholder="S1"
            value={form.shiftPreference}
            onChange={(event) => setForm({ ...form, shiftPreference: event.target.value })}
          />
        </div>
        <label className="flex items-center gap-2 sm:col-span-2">
          <input
            type="checkbox"
            className="rounded border-slate-300"
            checked={form.isCoreResource}
            onChange={(event) => setForm({ ...form, isCoreResource: event.target.checked })}
          />
          <span className="text-sm text-slate-700">
            Core resource — every shift needs at least one
          </span>
        </label>
      </div>
    </Modal>
  );
}
