import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PolicyConfig } from '@shift-planner/core';
import { api } from '../lib/api';
import { useSession } from '../hooks/useSession';
import { ErrorNotice, Modal, PageHeader, Spinner, Toast } from '../components/ui';
import type { Location, Shift, Team } from '../lib/types';

/** Shift configuration, capacity planning and the wellness policy (BRD 9, 10, 16-20). */
export function Settings() {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Shift | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  const shiftsQuery = useQuery({ queryKey: ['shifts'], queryFn: () => api<Shift[]>('/config/shifts') });
  const teamsQuery = useQuery({ queryKey: ['teams'], queryFn: () => api<Team[]>('/config/teams') });
  const locationsQuery = useQuery({
    queryKey: ['locations'],
    queryFn: () => api<Location[]>('/config/locations'),
  });
  const policyQuery = useQuery({
    queryKey: ['policy'],
    queryFn: () => api<PolicyConfig>('/config/policy'),
  });

  if (shiftsQuery.isLoading) return <Spinner label="Loading settings" />;
  if (shiftsQuery.error) return <ErrorNotice error={shiftsQuery.error} onRetry={shiftsQuery.refetch} />;

  const readOnly = !can('shift:write');

  return (
    <>
      <PageHeader
        title="Settings"
        description="Shift definitions, capacity plan and the workforce wellness policy"
        actions={
          can('shift:write') ? (
            <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
              Add shift
            </button>
          ) : null
        }
      />

      {readOnly ? (
        <div className="card mb-4 border-slate-200 bg-slate-50 px-5 py-3 text-sm text-slate-600">
          Your role can view configuration but not change it.
        </div>
      ) : null}

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Shifts and capacity
        </h2>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto thin-scroll">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Code</th>
                  <th className="th">Name</th>
                  <th className="th">Timing</th>
                  <th className="th">Min staff</th>
                  <th className="th">Max staff</th>
                  <th className="th">Leads</th>
                  <th className="th">Core</th>
                  <th className="th">Status</th>
                  {can('shift:write') ? <th className="th">Edit</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(shiftsQuery.data ?? []).map((shift) => (
                  <tr key={shift.id} className="hover:bg-slate-50">
                    <td className="td font-semibold">{shift.code}</td>
                    <td className="td">{shift.name}</td>
                    <td className="td whitespace-nowrap text-slate-600">
                      {shift.startTime} – {shift.endTime}
                    </td>
                    <td className="td tabular-nums">{shift.minStaff}</td>
                    <td className="td tabular-nums">{shift.maxStaff}</td>
                    <td className="td tabular-nums">{shift.shiftLeadsRequired}</td>
                    <td className="td tabular-nums">{shift.coreResourcesRequired}</td>
                    <td className="td">
                      <span
                        className={`badge ${
                          shift.isActive
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {shift.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {can('shift:write') ? (
                      <td className="td">
                        <button
                          type="button"
                          className="btn-secondary px-2 py-1 text-xs"
                          onClick={() => setEditing(shift)}
                        >
                          Edit
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Wellness policy
        </h2>
        {policyQuery.data ? (
          <PolicyEditor
            policy={policyQuery.data}
            readOnly={!can('settings:write')}
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ['policy'] });
              setToast({ message: 'Policy updated.', tone: 'success' });
            }}
            onError={(message) => setToast({ message, tone: 'error' })}
          />
        ) : (
          <Spinner />
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Teams
          </h2>
          <div className="card divide-y divide-slate-100">
            {(teamsQuery.data ?? []).map((team) => (
              <div key={team.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{team.name}</p>
                  <p className="text-xs text-slate-500">
                    {team.businessUnit ?? 'No business unit'}
                    {team.manager ? ` · Manager: ${team.manager.name}` : ''}
                  </p>
                </div>
                <span className="text-sm tabular-nums text-slate-500">
                  {team._count?.employees ?? 0} people
                </span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Locations
          </h2>
          <div className="card divide-y divide-slate-100">
            {(locationsQuery.data ?? []).map((location) => (
              <div key={location.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">{location.name}</p>
                  <p className="text-xs text-slate-500">{location.code}</p>
                </div>
                <span className="text-sm tabular-nums text-slate-500">
                  {location._count?.employees ?? 0} people · {location._count?.holidays ?? 0}{' '}
                  holidays
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {editing || creating ? (
        <ShiftModal
          shift={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            setEditing(null);
            setCreating(false);
            queryClient.invalidateQueries({ queryKey: ['shifts'] });
            setToast({ message: 'Shift saved.', tone: 'success' });
          }}
          onError={(message) => setToast({ message, tone: 'error' })}
        />
      ) : null}

      {toast ? <Toast {...toast} onDismiss={() => setToast(null)} /> : null}
    </>
  );
}

function PolicyEditor({
  policy,
  readOnly,
  onSaved,
  onError,
}: {
  policy: PolicyConfig;
  readOnly: boolean;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState(policy);
  useEffect(() => setForm(policy), [policy]);

  const save = useMutation({
    mutationFn: () =>
      api('/config/policy', {
        method: 'PUT',
        body: {
          minRestHours: form.minRestHours,
          minWeeklyOffs: form.minWeeklyOffs,
          maxConsecutiveDays: form.maxConsecutiveDays,
          preferredConsecutiveDays: form.preferredConsecutiveDays,
          maxShiftChangesPerWeek: form.maxShiftChangesPerWeek,
          distributionTolerance: form.distributionTolerance,
          holidayCoverageRatio: form.holidayCoverageRatio,
        },
      }),
    onSuccess: onSaved,
    onError: (caught) =>
      onError(caught instanceof Error ? caught.message : 'Could not update the policy'),
  });

  const fields: Array<{ key: keyof PolicyConfig; label: string; hint: string; step?: number }> = [
    { key: 'minRestHours', label: 'Minimum rest between shifts (hours)', hint: 'BRD 18' },
    { key: 'minWeeklyOffs', label: 'Minimum rest days per week', hint: 'BRD 19' },
    { key: 'maxConsecutiveDays', label: 'Maximum consecutive working days', hint: 'BRD 20 — never exceed' },
    { key: 'preferredConsecutiveDays', label: 'Preferred consecutive working days', hint: 'BRD 20 — the engine aims for this' },
    { key: 'maxShiftChangesPerWeek', label: 'Shift changes allowed per week', hint: 'BRD 16' },
    { key: 'distributionTolerance', label: 'Workload deviation tolerance', hint: '0.25 = 25% from the peer average', step: 0.05 },
    { key: 'holidayCoverageRatio', label: 'Holiday coverage ratio', hint: '0.5 = half the usual minimum staffing', step: 0.05 },
  ];

  return (
    <div className="card px-5 py-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((field) => (
          <div key={String(field.key)}>
            <label className="label" htmlFor={`policy-${String(field.key)}`}>
              {field.label}
            </label>
            <input
              id={`policy-${String(field.key)}`}
              type="number"
              step={field.step ?? 1}
              className="input"
              disabled={readOnly}
              value={String(form[field.key] ?? '')}
              onChange={(event) =>
                setForm({ ...form, [field.key]: Number(event.target.value) } as PolicyConfig)
              }
            />
            <p className="mt-1 text-xs text-slate-500">{field.hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Restricted transitions:{' '}
        {form.restrictedTransitions.map(([from, to]) => `${from} → ${to}`).join(', ')} · Preferred:{' '}
        {form.preferredTransitions.map(([from, to]) => `${from} → ${to}`).join(', ')}
      </div>

      {!readOnly ? (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="btn-primary"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save policy'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ShiftModal({
  shift,
  onClose,
  onSaved,
  onError,
}: {
  shift: Shift | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({
    code: shift?.code ?? '',
    name: shift?.name ?? '',
    startTime: shift?.startTime ?? '06:00 AM',
    endTime: shift?.endTime ?? '02:00 PM',
    minStaff: shift?.minStaff ?? 10,
    maxStaff: shift?.maxStaff ?? 15,
    shiftLeadsRequired: shift?.shiftLeadsRequired ?? 1,
    coreResourcesRequired: shift?.coreResourcesRequired ?? 1,
    isActive: shift?.isActive ?? true,
  });

  const save = useMutation({
    mutationFn: () =>
      shift
        ? api(`/config/shifts/${shift.id}`, { method: 'PATCH', body: form })
        : api('/config/shifts', { method: 'POST', body: form }),
    onSuccess: onSaved,
    onError: (caught) =>
      onError(caught instanceof Error ? caught.message : 'Could not save the shift'),
  });

  return (
    <Modal
      title={shift ? `Edit ${shift.code}` : 'Add shift'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={save.isPending || !form.code || !form.name}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="shift-code">
            Code
          </label>
          <input
            id="shift-code"
            className="input"
            value={form.code}
            onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
          />
        </div>
        <div>
          <label className="label" htmlFor="shift-name">
            Name
          </label>
          <input
            id="shift-name"
            className="input"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="shift-start">
            Starts
          </label>
          <input
            id="shift-start"
            className="input"
            placeholder="06:00 AM"
            value={form.startTime}
            onChange={(event) => setForm({ ...form, startTime: event.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="shift-end">
            Ends
          </label>
          <input
            id="shift-end"
            className="input"
            placeholder="02:00 PM"
            value={form.endTime}
            onChange={(event) => setForm({ ...form, endTime: event.target.value })}
          />
        </div>
        {(
          [
            ['minStaff', 'Minimum staff'],
            ['maxStaff', 'Maximum staff'],
            ['shiftLeadsRequired', 'Shift leads required'],
            ['coreResourcesRequired', 'Core resources required'],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <label className="label" htmlFor={`shift-${key}`}>
              {label}
            </label>
            <input
              id={`shift-${key}`}
              type="number"
              min={0}
              className="input"
              value={form[key]}
              onChange={(event) => setForm({ ...form, [key]: Number(event.target.value) })}
            />
          </div>
        ))}
        <label className="flex items-center gap-2 sm:col-span-2">
          <input
            type="checkbox"
            className="rounded border-slate-300"
            checked={form.isActive}
            onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
          />
          <span className="text-sm text-slate-700">
            Active — inactive shifts are excluded from generation and validation
          </span>
        </label>
      </div>
      <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
        Times accept 24-hour (<code>22:00</code>) or 12-hour (<code>10:00 PM</code>). A shift whose
        end is at or before its start is treated as crossing midnight.
      </p>
    </Modal>
  );
}
