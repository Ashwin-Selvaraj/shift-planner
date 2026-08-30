import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dateRange } from '@shift-planner/core';
import { api } from '../lib/api';
import { useSession } from '../hooks/useSession';
import { EmptyState, ErrorNotice, PageHeader, Spinner } from '../components/ui';
import { cellLabel, cellStyle, formatDate, shortDay, dayOfMonth } from '../lib/format';
import type { RosterDetail, RosterSummary } from '../lib/types';

/** An employee's own calendar (BRD section 6, "View Schedule"). */
export function MySchedule() {
  const { user } = useSession();
  const [rosterId, setRosterId] = useState<string>('');

  const rostersQuery = useQuery({
    queryKey: ['rosters', 'mine'],
    queryFn: () => api<RosterSummary[]>('/rosters'),
  });

  const rosters = useMemo(
    () => (rostersQuery.data ?? []).filter((r) => r.status === 'PUBLISHED' || r.status === 'APPROVED'),
    [rostersQuery.data],
  );
  const selected = rosterId || rosters[0]?.id || '';

  const rosterQuery = useQuery({
    queryKey: ['roster', selected],
    queryFn: () => api<RosterDetail>(`/rosters/${selected}`),
    enabled: Boolean(selected),
  });

  if (rostersQuery.isLoading) return <Spinner label="Loading your schedule" />;
  if (rostersQuery.error) return <ErrorNotice error={rostersQuery.error} onRetry={rostersQuery.refetch} />;

  if (rosters.length === 0) {
    return (
      <>
        <PageHeader title="My schedule" />
        <EmptyState
          title="No published roster yet"
          description="Your schedule appears here once a manager publishes the roster for your team."
        />
      </>
    );
  }

  const roster = rosterQuery.data;
  const mine = roster?.assignments.filter((a) => a.employeeId === user?.employeeId) ?? [];
  const byDate = new Map(mine.map((a) => [a.date, a]));
  const days = roster ? dateRange(roster.startDate, roster.endDate) : [];

  const counts = mine.reduce<Record<string, number>>((acc, a) => {
    const key = a.type === 'SHIFT' ? (a.shift?.code ?? 'Shift') : a.type;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="My schedule"
        description={roster ? `${roster.team?.name ?? ''} · ${roster.label}` : undefined}
        actions={
          <select
            className="input w-auto"
            value={selected}
            onChange={(event) => setRosterId(event.target.value)}
            aria-label="Select month"
          >
            {rosters.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} — {r.team?.name}
              </option>
            ))}
          </select>
        }
      />

      {rosterQuery.isLoading ? (
        <Spinner />
      ) : (
        <>
          <section className="mb-6 flex flex-wrap gap-3">
            {Object.entries(counts).map(([key, value]) => (
              <div key={key} className="card px-4 py-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">{key}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
              </div>
            ))}
          </section>

          {/* A calendar reads better than a table for a single person. */}
          <div className="card p-4">
            <div className="grid grid-cols-7 gap-2">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => (
                <div key={label} className="pb-1 text-center text-xs font-semibold text-slate-500">
                  {label}
                </div>
              ))}
              {days.length > 0
                ? Array.from({
                    length: (() => {
                      const first = days[0] as string;
                      const index = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(
                        shortDay(first),
                      );
                      return index < 0 ? 0 : index;
                    })(),
                  }).map((_, index) => (
                    <div key={`pad-${index}`} />
                  ))
                : null}
              {days.map((day) => {
                const assignment = byDate.get(day);
                const type = assignment?.type ?? 'OFF';
                const code = assignment?.shift?.code;
                return (
                  <div
                    key={day}
                    className={`flex min-h-20 flex-col rounded-lg border p-2 ${cellStyle(type, code)}`}
                    title={formatDate(day)}
                  >
                    <span className="text-xs font-medium opacity-70">{dayOfMonth(day)}</span>
                    <span className="mt-auto text-sm font-semibold">{cellLabel(type, code)}</span>
                    {assignment?.type === 'SHIFT' && assignment.shift ? (
                      <span className="text-[10px] opacity-75">{assignment.shift.name}</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
