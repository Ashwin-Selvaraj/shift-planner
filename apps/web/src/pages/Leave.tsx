import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useSession } from '../hooks/useSession';
import { EmptyState, ErrorNotice, Modal, PageHeader, Spinner, Toast } from '../components/ui';
import { formatDate } from '../lib/format';
import type { Employee, Leave } from '../lib/types';

interface ReplacementResponse {
  leave: { id: string; employee: { id: string; name: string }; startDate: string; endDate: string };
  affectedDays: Array<{
    date: string;
    shift: { id: string; code: string; name: string };
    suggestions: Array<{
      employee: { id: string; employeeId: string; name: string; role: string; isCoreResource: boolean };
      score: number;
      reasons: string[];
    }>;
  }>;
}

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-rose-100 text-rose-800',
  CANCELLED: 'bg-slate-100 text-slate-600',
};

/** Leave management and the emergency-leave workflow (BRD section 21). */
export function LeavePage() {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [requestOpen, setRequestOpen] = useState(false);
  const [reviewing, setReviewing] = useState<Leave | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  const leavesQuery = useQuery({
    queryKey: ['leaves', statusFilter],
    queryFn: () => api<Leave[]>(`/leaves${statusFilter ? `?status=${statusFilter}` : ''}`),
  });

  if (leavesQuery.isLoading) return <Spinner label="Loading leave requests" />;
  if (leavesQuery.error) return <ErrorNotice error={leavesQuery.error} onRetry={leavesQuery.refetch} />;

  const leaves = leavesQuery.data ?? [];

  return (
    <>
      <PageHeader
        title="Leave"
        description="Planned and emergency leave, with coverage-aware replacement suggestions"
        actions={
          <>
            <select
              className="input w-auto"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </select>
            {can('leave:request') ? (
              <button type="button" className="btn-primary" onClick={() => setRequestOpen(true)}>
                Request leave
              </button>
            ) : null}
          </>
        }
      />

      {leaves.length === 0 ? (
        <EmptyState title="No leave requests" description="Requests appear here as they are raised." />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto thin-scroll">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Employee</th>
                  <th className="th">Dates</th>
                  <th className="th">Type</th>
                  <th className="th">Status</th>
                  <th className="th">Replacement</th>
                  <th className="th">Reason</th>
                  {can('leave:approve') ? <th className="th">Action</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {leaves.map((leave) => (
                  <tr key={leave.id} className="hover:bg-slate-50">
                    <td className="td">
                      <p className="font-medium text-slate-800">{leave.employee?.name ?? '—'}</p>
                      <p className="text-xs text-slate-500">{leave.employee?.employeeId}</p>
                    </td>
                    <td className="td whitespace-nowrap">
                      {formatDate(leave.startDate)}
                      {leave.startDate !== leave.endDate ? ` – ${formatDate(leave.endDate)}` : ''}
                    </td>
                    <td className="td">
                      <span
                        className={`badge ${
                          leave.kind === 'EMERGENCY'
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {leave.kind === 'EMERGENCY' ? 'Emergency' : 'Planned'}
                      </span>
                    </td>
                    <td className="td">
                      <span className={`badge ${STATUS_STYLES[leave.status] ?? ''}`}>
                        {leave.status.charAt(0) + leave.status.slice(1).toLowerCase()}
                      </span>
                    </td>
                    <td className="td text-slate-500">{leave.replacement?.name ?? '—'}</td>
                    <td className="td max-w-xs truncate text-slate-500">{leave.reason ?? '—'}</td>
                    {can('leave:approve') ? (
                      <td className="td">
                        {leave.status === 'PENDING' ? (
                          <button
                            type="button"
                            className="btn-secondary px-2 py-1 text-xs"
                            onClick={() => setReviewing(leave)}
                          >
                            Review
                          </button>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {requestOpen ? (
        <RequestLeaveModal
          onClose={() => setRequestOpen(false)}
          onDone={() => {
            setRequestOpen(false);
            queryClient.invalidateQueries({ queryKey: ['leaves'] });
            setToast({ message: 'Leave request submitted.', tone: 'success' });
          }}
          onError={(message) => setToast({ message, tone: 'error' })}
        />
      ) : null}

      {reviewing ? (
        <ReviewLeaveModal
          leave={reviewing}
          onClose={() => setReviewing(null)}
          onDone={(message) => {
            setReviewing(null);
            queryClient.invalidateQueries({ queryKey: ['leaves'] });
            setToast({ message, tone: 'success' });
          }}
          onError={(message) => setToast({ message, tone: 'error' })}
        />
      ) : null}

      {toast ? <Toast {...toast} onDismiss={() => setToast(null)} /> : null}
    </>
  );
}

function RequestLeaveModal({
  onClose,
  onDone,
  onError,
}: {
  onClose: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const { user, can } = useSession();
  const employeesQuery = useQuery({
    queryKey: ['employees'],
    queryFn: () => api<Employee[]>('/employees'),
    enabled: can('employee:read'),
  });

  const [form, setForm] = useState({
    employeeId: user?.employeeId ?? '',
    startDate: '',
    endDate: '',
    kind: 'PLANNED',
    reason: '',
  });

  const submit = useMutation({
    mutationFn: () => api('/leaves', { method: 'POST', body: form }),
    onSuccess: onDone,
    onError: (caught) =>
      onError(caught instanceof Error ? caught.message : 'Could not submit the request'),
  });

  const valid = form.employeeId && form.startDate && form.endDate && form.endDate >= form.startDate;

  return (
    <Modal
      title="Request leave"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!valid || submit.isPending}
            onClick={() => submit.mutate()}
          >
            {submit.isPending ? 'Submitting…' : 'Submit'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {can('employee:read') ? (
          <div>
            <label className="label" htmlFor="leave-employee">
              Employee
            </label>
            <select
              id="leave-employee"
              className="input"
              value={form.employeeId}
              onChange={(event) => setForm({ ...form, employeeId: event.target.value })}
            >
              <option value="">Select…</option>
              {(employeesQuery.data ?? []).map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name} ({employee.employeeId})
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="leave-from">
              From
            </label>
            <input
              id="leave-from"
              type="date"
              className="input"
              value={form.startDate}
              onChange={(event) => setForm({ ...form, startDate: event.target.value })}
            />
          </div>
          <div>
            <label className="label" htmlFor="leave-to">
              To
            </label>
            <input
              id="leave-to"
              type="date"
              className="input"
              value={form.endDate}
              onChange={(event) => setForm({ ...form, endDate: event.target.value })}
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="leave-kind">
            Type
          </label>
          <select
            id="leave-kind"
            className="input"
            value={form.kind}
            onChange={(event) => setForm({ ...form, kind: event.target.value })}
          >
            <option value="PLANNED">Planned</option>
            <option value="EMERGENCY">Emergency</option>
          </select>
        </div>

        <div>
          <label className="label" htmlFor="leave-reason">
            Reason
          </label>
          <textarea
            id="leave-reason"
            className="input"
            rows={2}
            value={form.reason}
            onChange={(event) => setForm({ ...form, reason: event.target.value })}
          />
        </div>
      </div>
    </Modal>
  );
}

/**
 * Approval screen. Before a decision is taken it shows exactly which shifts the
 * absence would leave short, and ranks eligible stand-ins with the reasons the
 * engine used — a planner should not have to guess.
 */
function ReviewLeaveModal({
  leave,
  onClose,
  onDone,
  onError,
}: {
  leave: Leave;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [replacementId, setReplacementId] = useState('');
  const [reason, setReason] = useState('');

  const coverage = useQuery({
    queryKey: ['leave-replacements', leave.id],
    queryFn: () => api<ReplacementResponse>(`/leaves/${leave.id}/replacements`),
  });

  const decide = useMutation({
    mutationFn: (decision: 'APPROVED' | 'REJECTED') =>
      api<{ uncovered: Array<{ date: string; shiftCode: string }> }>(
        `/leaves/${leave.id}/decision`,
        {
          method: 'POST',
          body: { decision, reason: reason || null, replacementId: replacementId || null },
        },
      ),
    onSuccess: (result, decision) => {
      const uncovered = result.uncovered ?? [];
      onDone(
        decision === 'APPROVED'
          ? uncovered.length > 0
            ? `Leave approved. ${uncovered.length} shift(s) still need cover.`
            : 'Leave approved and coverage maintained.'
          : 'Leave rejected.',
      );
    },
    onError: (caught) =>
      onError(caught instanceof Error ? caught.message : 'Could not record the decision'),
  });

  return (
    <Modal
      title={`Review leave — ${leave.employee?.name ?? ''}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            disabled={decide.isPending}
            onClick={() => decide.mutate('REJECTED')}
          >
            Reject
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={decide.isPending}
            onClick={() => decide.mutate('APPROVED')}
          >
            {decide.isPending ? 'Saving…' : 'Approve'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {formatDate(leave.startDate)}
          {leave.startDate !== leave.endDate ? ` – ${formatDate(leave.endDate)}` : ''} ·{' '}
          {leave.kind === 'EMERGENCY' ? 'Emergency' : 'Planned'}
          {leave.reason ? ` · ${leave.reason}` : ''}
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Coverage impact</h3>
          {coverage.isLoading ? (
            <p className="text-sm text-slate-500">Checking coverage…</p>
          ) : coverage.data && coverage.data.affectedDays.length > 0 ? (
            <div className="space-y-3">
              {coverage.data.affectedDays.map((day) => (
                <div key={day.date} className="rounded-lg border border-slate-200 px-3 py-2">
                  <p className="text-sm font-medium text-slate-800">
                    {formatDate(day.date)} · {day.shift.code} ({day.shift.name})
                  </p>
                  {day.suggestions.length === 0 ? (
                    <p className="mt-1 text-xs text-rose-600">
                      No eligible replacement — approving leaves this shift short.
                    </p>
                  ) : (
                    <div className="mt-2 space-y-1">
                      {day.suggestions.slice(0, 4).map((suggestion) => (
                        <label
                          key={suggestion.employee.id}
                          className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50"
                        >
                          <input
                            type="radio"
                            name="replacement"
                            className="mt-1"
                            checked={replacementId === suggestion.employee.id}
                            onChange={() => setReplacementId(suggestion.employee.id)}
                          />
                          <span className="min-w-0">
                            <span className="block text-sm text-slate-800">
                              {suggestion.employee.name}
                              {suggestion.employee.isCoreResource ? (
                                <span className="badge ml-2 bg-sky-100 text-sky-700">Core</span>
                              ) : null}
                            </span>
                            <span className="block text-xs text-slate-500">
                              {suggestion.reasons.join(' · ')}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-emerald-700">
              This absence does not affect any rostered shift.
            </p>
          )}
        </div>

        <div>
          <label className="label" htmlFor="decision-reason">
            Decision note (recorded in the audit trail)
          </label>
          <textarea
            id="decision-reason"
            className="input"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
