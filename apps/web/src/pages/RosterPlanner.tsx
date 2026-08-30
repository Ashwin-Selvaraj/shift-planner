import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dateRange, isoWeekKey } from '@shift-planner/core';
import { api } from '../lib/api';
import { useSession } from '../hooks/useSession';
import {
  ErrorNotice,
  Modal,
  PageHeader,
  Spinner,
  Toast,
  ValidationPanel,
} from '../components/ui';
import {
  ROLE_LABELS,
  STATUS_STYLES,
  cellLabel,
  cellStyle,
  dayOfMonth,
  formatDate,
  shortDay,
  statusLabel,
} from '../lib/format';
import type { AssignmentType, RosterDetail, Shift, ValidationResult } from '../lib/types';

type ViewMode = 'month' | 'week' | 'day';

/** What a palette chip or a grid cell carries while being dragged. */
interface DragPayload {
  type: AssignmentType;
  shiftId: string | null;
  shiftCode?: string;
}

/**
 * Monthly roster planning (BRD section 12): month, week and day views,
 * drag-and-drop assignment, bulk assignment and live conflict detection.
 */
export function RosterPlanner() {
  const { id = '' } = useParams();
  const { can } = useSession();
  const queryClient = useQueryClient();

  const [view, setView] = useState<ViewMode>('month');
  const [weekIndex, setWeekIndex] = useState(0);
  const [dayIndex, setDayIndex] = useState(0);
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [overridePrompt, setOverridePrompt] = useState<{
    employeeId: string;
    date: string;
    payload: DragPayload;
  } | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  const rosterQuery = useQuery({
    queryKey: ['roster', id],
    queryFn: () => api<RosterDetail>(`/rosters/${id}`),
    enabled: Boolean(id),
  });
  const shiftsQuery = useQuery({
    queryKey: ['shifts'],
    queryFn: () => api<Shift[]>('/config/shifts'),
  });

  const roster = rosterQuery.data;
  const shifts = useMemo(
    () => (shiftsQuery.data ?? []).filter((shift) => shift.isActive),
    [shiftsQuery.data],
  );

  const days = useMemo(
    () => (roster ? dateRange(roster.startDate, roster.endDate) : []),
    [roster],
  );

  const weeks = useMemo(() => {
    const grouped = new Map<string, string[]>();
    for (const day of days) {
      const key = isoWeekKey(day);
      grouped.set(key, [...(grouped.get(key) ?? []), day]);
    }
    return [...grouped.values()];
  }, [days]);

  /** employeeId -> date -> assignment, for O(1) cell lookups. */
  const grid = useMemo(() => {
    const map = new Map<string, Map<string, RosterDetail['assignments'][number]>>();
    for (const assignment of roster?.assignments ?? []) {
      const row = map.get(assignment.employeeId) ?? new Map();
      row.set(assignment.date, assignment);
      map.set(assignment.employeeId, row);
    }
    return map;
  }, [roster]);

  /**
   * Per-day headcount against the capacity plan, so understaffing is visible in
   * the grid itself rather than only in the validation panel.
   */
  const coverage = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const assignment of roster?.assignments ?? []) {
      if (assignment.type !== 'SHIFT' || !assignment.shiftId) continue;
      const row = map.get(assignment.date) ?? new Map();
      row.set(assignment.shiftId, (row.get(assignment.shiftId) ?? 0) + 1);
      map.set(assignment.date, row);
    }
    return map;
  }, [roster]);

  const editable = can('roster:write') && roster?.status !== 'PUBLISHED';

  const assign = useMutation({
    mutationFn: (input: {
      employeeId: string;
      date: string;
      type: AssignmentType;
      shiftId: string | null;
      overrideReason?: string;
    }) =>
      api<{ validation: ValidationResult }>(`/rosters/${id}/assignments`, {
        method: 'PUT',
        body: input,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['roster', id] }),
    onError: (caught) =>
      setToast({ message: caught instanceof Error ? caught.message : 'Update failed', tone: 'error' }),
  });

  const bulkAssign = useMutation({
    mutationFn: (input: {
      employeeIds: string[];
      dates: string[];
      type: AssignmentType;
      shiftId: string | null;
    }) => api(`/rosters/${id}/assignments/bulk`, { method: 'POST', body: input }),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['roster', id] });
      setBulkOpen(false);
      setSelection(new Set());
      setToast({
        message: `Updated ${variables.employeeIds.length * variables.dates.length} cell(s).`,
        tone: 'success',
      });
    },
    onError: (caught) =>
      setToast({ message: caught instanceof Error ? caught.message : 'Bulk update failed', tone: 'error' }),
  });

  const lifecycle = useMutation({
    mutationFn: ({ action, reason }: { action: string; reason?: string }) =>
      api(`/rosters/${id}/${action}`, { method: 'POST', body: reason ? { reason } : {} }),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['roster', id] });
      setToast({ message: `Roster ${variables.action}d.`, tone: 'success' });
    },
    onError: (caught) => {
      const details = (caught as { details?: { issues?: Array<{ message: string }> } }).details;
      const first = details?.issues?.[0]?.message;
      setToast({
        message:
          (caught instanceof Error ? caught.message : 'Action failed') +
          (first ? ` First issue: ${first}` : ''),
        tone: 'error',
      });
    },
  });

  /**
   * Applies a drop. A restricted transition (BRD 17) is not silently written —
   * the planner is asked for the management override reason first, and that
   * reason lands in the audit trail.
   */
  function applyDrop(employeeId: string, date: string, payload: DragPayload) {
    if (!editable || !roster) return;

    if (payload.type === 'SHIFT' && payload.shiftCode) {
      const previousDay = days[days.indexOf(date) - 1];
      const previous = previousDay ? grid.get(employeeId)?.get(previousDay) : undefined;
      const previousCode = previous?.shift?.code;
      const restricted =
        previousCode &&
        ((previousCode === 'S1' && payload.shiftCode === 'S3') ||
          (previousCode === 'S3' && payload.shiftCode === 'S1'));
      if (restricted) {
        setOverridePrompt({ employeeId, date, payload });
        return;
      }
    }

    assign.mutate({ employeeId, date, type: payload.type, shiftId: payload.shiftId });
  }

  if (rosterQuery.isLoading) return <Spinner label="Loading roster" />;
  if (rosterQuery.error) return <ErrorNotice error={rosterQuery.error} onRetry={rosterQuery.refetch} />;
  if (!roster) return null;

  const visibleDays =
    view === 'month'
      ? days
      : view === 'week'
        ? (weeks[Math.min(weekIndex, weeks.length - 1)] ?? [])
        : [days[Math.min(dayIndex, days.length - 1)] ?? days[0] ?? ''];

  const toggleSelection = (employeeId: string) => {
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  };

  return (
    <>
      <PageHeader
        title={`${roster.team?.name ?? 'Roster'} — ${roster.label}`}
        description={`${formatDate(roster.startDate)} to ${formatDate(roster.endDate)} · ${roster.employees.length} employees`}
        actions={
          <>
            <Link to="/roster" className="btn-secondary">
              All rosters
            </Link>
            <span className={`badge ${STATUS_STYLES[roster.status]} px-3 py-1.5`}>
              {statusLabel(roster.status)}
            </span>
            {can('roster:approve') && roster.status !== 'PUBLISHED' ? (
              <button
                type="button"
                className="btn-secondary"
                disabled={lifecycle.isPending}
                onClick={() => lifecycle.mutate({ action: 'approve' })}
              >
                Approve
              </button>
            ) : null}
            {can('roster:publish') && roster.status !== 'PUBLISHED' ? (
              <button
                type="button"
                className="btn-primary"
                disabled={lifecycle.isPending}
                onClick={() => lifecycle.mutate({ action: 'publish' })}
              >
                Publish
              </button>
            ) : null}
            {can('roster:publish') && roster.status === 'PUBLISHED' ? (
              <button
                type="button"
                className="btn-danger"
                disabled={lifecycle.isPending}
                onClick={() => {
                  const reason = window.prompt(
                    'Why is this published roster being withdrawn? This is recorded in the audit trail.',
                  );
                  if (reason && reason.trim().length >= 3) {
                    lifecycle.mutate({ action: 'withdraw', reason: reason.trim() });
                  }
                }}
              >
                Withdraw
              </button>
            ) : null}
          </>
        }
      />

      {roster.status === 'PUBLISHED' ? (
        <div className="card mb-4 border-emerald-200 bg-emerald-50 px-5 py-3 text-sm text-emerald-900">
          This roster is published and read-only. Withdraw it to make changes.
        </div>
      ) : null}

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        {/*
          `min-w-0` is load-bearing: a grid item defaults to `min-width: auto`,
          so without it the month-wide roster table inflates this column instead
          of scrolling inside its own container, and the whole page ends up
          scrolling sideways on every screen size.
        */}
        <div className="min-w-0 lg:col-span-2">
          {/* View switch and shift palette */}
          <div className="card mb-4 flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="flex rounded-lg border border-slate-300 p-0.5">
              {(['month', 'week', 'day'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setView(mode)}
                  className={`rounded-md px-3 py-1 text-sm font-medium capitalize transition ${
                    view === mode ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>

            {view === 'week' ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn-secondary px-2 py-1"
                  disabled={weekIndex === 0}
                  onClick={() => setWeekIndex((i) => Math.max(0, i - 1))}
                >
                  ‹
                </button>
                <span className="text-sm text-slate-600">
                  Week {weekIndex + 1} of {weeks.length}
                </span>
                <button
                  type="button"
                  className="btn-secondary px-2 py-1"
                  disabled={weekIndex >= weeks.length - 1}
                  onClick={() => setWeekIndex((i) => Math.min(weeks.length - 1, i + 1))}
                >
                  ›
                </button>
              </div>
            ) : null}

            {view === 'day' ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn-secondary px-2 py-1"
                  disabled={dayIndex === 0}
                  onClick={() => setDayIndex((i) => Math.max(0, i - 1))}
                >
                  ‹
                </button>
                <span className="text-sm text-slate-600">
                  {formatDate(days[dayIndex] ?? roster.startDate)}
                </span>
                <button
                  type="button"
                  className="btn-secondary px-2 py-1"
                  disabled={dayIndex >= days.length - 1}
                  onClick={() => setDayIndex((i) => Math.min(days.length - 1, i + 1))}
                >
                  ›
                </button>
              </div>
            ) : null}

            {editable ? (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-slate-500">Drag onto a cell:</span>
                {shifts.map((shift) => (
                  <span
                    key={shift.id}
                    draggable
                    onDragStart={() =>
                      setDragging({ type: 'SHIFT', shiftId: shift.id, shiftCode: shift.code })
                    }
                    onDragEnd={() => setDragging(null)}
                    title={`${shift.name} · ${shift.startTime} – ${shift.endTime}`}
                    className={`cursor-grab select-none rounded-md border px-2.5 py-1 text-xs font-semibold active:cursor-grabbing ${cellStyle('SHIFT', shift.code)}`}
                  >
                    {shift.code}
                  </span>
                ))}
                {(['OFF', 'LEAVE', 'HOLIDAY'] as const).map((type) => (
                  <span
                    key={type}
                    draggable
                    onDragStart={() => setDragging({ type, shiftId: null })}
                    onDragEnd={() => setDragging(null)}
                    title={type}
                    className={`cursor-grab select-none rounded-md border px-2.5 py-1 text-xs font-semibold active:cursor-grabbing ${cellStyle(type)}`}
                  >
                    {cellLabel(type)}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {selection.size > 0 && editable ? (
            <div className="card mb-4 flex flex-wrap items-center gap-3 border-slate-900 px-4 py-3">
              <span className="text-sm font-medium text-slate-800">
                {selection.size} employee(s) selected
              </span>
              <button type="button" className="btn-primary" onClick={() => setBulkOpen(true)}>
                Bulk assign
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSelection(new Set())}
              >
                Clear
              </button>
            </div>
          ) : null}

          {/* The grid. Employee rows, day columns. */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto thin-scroll">
              <table className="min-w-full border-collapse">
                <thead className="sticky top-0 z-10 bg-slate-50">
                  <tr>
                    <th className="sticky left-0 z-20 min-w-56 bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Employee
                    </th>
                    {visibleDays.map((day) => {
                      const weekend = ['Sat', 'Sun'].includes(shortDay(day));
                      return (
                        <th
                          key={day}
                          className={`min-w-11 px-1 py-2 text-center text-[11px] font-semibold ${
                            weekend ? 'bg-slate-100 text-slate-500' : 'text-slate-600'
                          }`}
                        >
                          <div>{shortDay(day)}</div>
                          <div className="text-slate-400">{dayOfMonth(day)}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {roster.employees.map((employee) => (
                    <tr key={employee.id} className="hover:bg-slate-50/60">
                      <td className="sticky left-0 z-10 bg-white px-3 py-1.5">
                        <label className="flex items-center gap-2">
                          {editable ? (
                            <input
                              type="checkbox"
                              className="rounded border-slate-300"
                              checked={selection.has(employee.id)}
                              onChange={() => toggleSelection(employee.id)}
                              aria-label={`Select ${employee.name}`}
                            />
                          ) : null}
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-slate-800">
                              {employee.name}
                            </span>
                            <span className="block truncate text-[11px] text-slate-500">
                              {employee.employeeId} · {ROLE_LABELS[employee.role]}
                              {employee.isCoreResource ? ' · Core' : ''}
                            </span>
                          </span>
                        </label>
                      </td>

                      {visibleDays.map((day) => {
                        const assignment = grid.get(employee.id)?.get(day);
                        const type = assignment?.type ?? 'OFF';
                        const code = assignment?.shift?.code;
                        return (
                          <td key={day} className="p-0.5 text-center">
                            <button
                              type="button"
                              draggable={editable && Boolean(assignment)}
                              onDragStart={() =>
                                assignment &&
                                setDragging({
                                  type: assignment.type,
                                  shiftId: assignment.shiftId ?? null,
                                  shiftCode: assignment.shift?.code,
                                })
                              }
                              onDragEnd={() => setDragging(null)}
                              onDragOver={(event) => editable && event.preventDefault()}
                              onDrop={(event) => {
                                event.preventDefault();
                                if (dragging) applyDrop(employee.id, day, dragging);
                              }}
                              onClick={() => {
                                if (!editable) return;
                                // Click cycles through the legend, so the grid
                                // is usable on a touch screen where there is no
                                // drag affordance (BRD 29).
                                const order: DragPayload[] = [
                                  ...shifts.map((s) => ({
                                    type: 'SHIFT' as const,
                                    shiftId: s.id,
                                    shiftCode: s.code,
                                  })),
                                  { type: 'OFF', shiftId: null },
                                  { type: 'LEAVE', shiftId: null },
                                  { type: 'HOLIDAY', shiftId: null },
                                ];
                                const currentIndex = order.findIndex((option) =>
                                  assignment?.type === 'SHIFT'
                                    ? option.shiftId === assignment.shiftId
                                    : option.type === assignment?.type,
                                );
                                const next = order[(currentIndex + 1) % order.length];
                                if (next) applyDrop(employee.id, day, next);
                              }}
                              disabled={!editable}
                              title={
                                assignment?.overrideReason
                                  ? `Override: ${assignment.overrideReason}`
                                  : `${employee.name} · ${formatDate(day)}`
                              }
                              className={`h-8 w-full rounded border text-[11px] font-semibold transition ${cellStyle(type, code)} ${
                                editable ? 'hover:ring-2 hover:ring-slate-400' : 'cursor-default'
                              } ${assignment?.locked ? 'ring-1 ring-inset ring-slate-400/60' : ''}`}
                            >
                              {cellLabel(type, code)}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}

                  {/* Coverage footer: staffing against the capacity plan. */}
                  {shifts.map((shift) => (
                    <tr key={`cov-${shift.id}`} className="bg-slate-50">
                      <td className="sticky left-0 z-10 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">
                        {shift.code} staffed (min {shift.minStaff})
                      </td>
                      {visibleDays.map((day) => {
                        const count = coverage.get(day)?.get(shift.id) ?? 0;
                        const short = count < shift.minStaff;
                        const over = count > shift.maxStaff;
                        return (
                          <td key={day} className="px-1 py-1.5 text-center">
                            <span
                              className={`text-[11px] font-semibold tabular-nums ${
                                short ? 'text-rose-600' : over ? 'text-amber-600' : 'text-slate-500'
                              }`}
                            >
                              {count}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span className="font-medium">Legend:</span>
            {shifts.map((shift) => (
              <span key={shift.id} className="flex items-center gap-1.5">
                <span
                  className={`inline-block h-3.5 w-5 rounded border ${cellStyle('SHIFT', shift.code)}`}
                />
                {shift.code} = {shift.name} ({shift.startTime} – {shift.endTime})
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span className={`inline-block h-3.5 w-5 rounded border ${cellStyle('OFF')}`} />O =
              Weekly off
            </span>
            <span className="flex items-center gap-1.5">
              <span className={`inline-block h-3.5 w-5 rounded border ${cellStyle('LEAVE')}`} />L =
              Leave
            </span>
            <span className="flex items-center gap-1.5">
              <span className={`inline-block h-3.5 w-5 rounded border ${cellStyle('HOLIDAY')}`} />H
              = Holiday
            </span>
          </div>
        </div>

        <div className="space-y-4">
          <ValidationPanel validation={roster.validation ?? null} />
          <div className="card px-5 py-4">
            <h3 className="text-sm font-semibold text-slate-900">How editing works</h3>
            <ul className="mt-2 space-y-1.5 text-xs text-slate-600">
              <li>· Drag a chip from the palette onto any cell, or drag one cell onto another.</li>
              <li>· Tap a cell to cycle through the legend on a touch device.</li>
              <li>· Manual edits are locked and survive regeneration.</li>
              <li>· A restricted transition asks for a management override reason.</li>
              <li>· Validation re-runs after every change.</li>
            </ul>
          </div>
        </div>
      </div>

      {bulkOpen ? (
        <BulkAssignModal
          shifts={shifts}
          days={days}
          count={selection.size}
          busy={bulkAssign.isPending}
          onClose={() => setBulkOpen(false)}
          onApply={(payload) =>
            bulkAssign.mutate({
              employeeIds: [...selection],
              dates: payload.dates,
              type: payload.type,
              shiftId: payload.shiftId,
            })
          }
        />
      ) : null}

      {overridePrompt ? (
        <Modal
          title="Management override required"
          onClose={() => setOverridePrompt(null)}
          footer={
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setOverridePrompt(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={(event) => {
                  const input = (
                    event.currentTarget.closest('div[role="dialog"]') as HTMLElement | null
                  )?.querySelector<HTMLTextAreaElement>('#override-reason');
                  const reason = input?.value.trim();
                  if (!reason) return;
                  assign.mutate({
                    employeeId: overridePrompt.employeeId,
                    date: overridePrompt.date,
                    type: overridePrompt.payload.type,
                    shiftId: overridePrompt.payload.shiftId,
                    overrideReason: reason,
                  });
                  setOverridePrompt(null);
                }}
              >
                Apply override
              </button>
            </>
          }
        >
          <p className="text-sm text-slate-600">
            This change creates a restricted shift transition (BRD section 17). It can be applied,
            but only with a stated reason, which is recorded in the audit trail.
          </p>
          <label className="label mt-4" htmlFor="override-reason">
            Reason for the override
          </label>
          <textarea id="override-reason" className="input" rows={3} autoFocus />
        </Modal>
      ) : null}

      {toast ? <Toast {...toast} onDismiss={() => setToast(null)} /> : null}
    </>
  );
}

function BulkAssignModal({
  shifts,
  days,
  count,
  busy,
  onClose,
  onApply,
}: {
  shifts: Shift[];
  days: string[];
  count: number;
  busy: boolean;
  onClose: () => void;
  onApply: (payload: { dates: string[]; type: AssignmentType; shiftId: string | null }) => void;
}) {
  const [type, setType] = useState<AssignmentType>('SHIFT');
  const [shiftId, setShiftId] = useState(shifts[0]?.id ?? '');
  const [from, setFrom] = useState(days[0] ?? '');
  const [to, setTo] = useState(days[Math.min(6, days.length - 1)] ?? '');

  const selected = days.filter((day) => day >= from && day <= to);

  return (
    <Modal
      title={`Bulk assign · ${count} employee(s)`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || selected.length === 0 || (type === 'SHIFT' && !shiftId)}
            onClick={() =>
              onApply({ dates: selected, type, shiftId: type === 'SHIFT' ? shiftId : null })
            }
          >
            {busy ? 'Applying…' : `Apply to ${count * selected.length} cell(s)`}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="bulk-type">
            Assign
          </label>
          <select
            id="bulk-type"
            className="input"
            value={type}
            onChange={(event) => setType(event.target.value as AssignmentType)}
          >
            <option value="SHIFT">Shift</option>
            <option value="OFF">Weekly off</option>
            <option value="LEAVE">Leave</option>
            <option value="HOLIDAY">Holiday</option>
          </select>
        </div>

        {type === 'SHIFT' ? (
          <div>
            <label className="label" htmlFor="bulk-shift">
              Shift
            </label>
            <select
              id="bulk-shift"
              className="input"
              value={shiftId}
              onChange={(event) => setShiftId(event.target.value)}
            >
              {shifts.map((shift) => (
                <option key={shift.id} value={shift.id}>
                  {shift.code} — {shift.name} ({shift.startTime} – {shift.endTime})
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="bulk-from">
              From
            </label>
            <select
              id="bulk-from"
              className="input"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            >
              {days.map((day) => (
                <option key={day} value={day}>
                  {formatDate(day)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="bulk-to">
              To
            </label>
            <select
              id="bulk-to"
              className="input"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            >
              {days.map((day) => (
                <option key={day} value={day}>
                  {formatDate(day)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {selected.length} day(s) selected. Bulk edits are locked and survive regeneration.
          Validation runs immediately afterwards, so any conflict this creates is reported.
        </p>
      </div>
    </Modal>
  );
}
