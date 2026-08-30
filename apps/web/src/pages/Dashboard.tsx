import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useSession } from '../hooks/useSession';
import { STATUS_STYLES, statusLabel, formatDate, MONTHS } from '../lib/format';
import { ErrorNotice, PageHeader, Spinner, StatCard, Modal, Toast } from '../components/ui';
import type { DashboardResponse, RosterSummary } from '../lib/types';

/** Dashboard metrics and quick actions (BRD section 11). */
export function Dashboard() {
  const { can, user } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [teamId, setTeamId] = useState<string>('');
  const [generateOpen, setGenerateOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard', teamId],
    queryFn: () => api<DashboardResponse>(`/dashboard${teamId ? `?teamId=${teamId}` : ''}`),
  });

  const now = new Date();
  const [form, setForm] = useState({
    teamId: '',
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 2 > 12 ? 1 : now.getUTCMonth() + 2,
  });

  const generate = useMutation({
    mutationFn: (input: { teamId: string; year: number; month: number }) =>
      api<{ roster: RosterSummary; stats: { durationMs: number; shiftAssignments: number } }>(
        '/rosters/generate',
        { method: 'POST', body: { ...input, overwrite: true } },
      ),
    onSuccess: (result) => {
      setGenerateOpen(false);
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setToast({
        message: `Generated ${result.stats.shiftAssignments} assignments in ${result.stats.durationMs}ms.`,
        tone: 'success',
      });
      navigate(`/roster/${result.roster.id}`);
    },
    onError: (caught) =>
      setToast({
        message: caught instanceof Error ? caught.message : 'Generation failed',
        tone: 'error',
      }),
  });

  if (isLoading) return <Spinner label="Loading dashboard" />;
  if (error) return <ErrorNotice error={error} onRetry={refetch} />;
  if (!data) return null;

  const { metrics } = data;
  const coverageTone = (value: number | null): 'good' | 'warn' | 'bad' | 'neutral' => {
    if (value === null) return 'neutral';
    if (value >= 100) return 'good';
    if (value >= 90) return 'warn';
    return 'bad';
  };
  const show = (value: number | null, suffix = '') => (value === null ? '—' : `${value}${suffix}`);

  return (
    <>
      <PageHeader
        title={`Good day, ${user?.name.split(' ')[0] ?? 'there'}`}
        description={`Workforce position for ${formatDate(data.date)}`}
        actions={
          <>
            {data.teams.length > 1 ? (
              <select
                className="input w-auto"
                value={teamId}
                onChange={(event) => setTeamId(event.target.value)}
                aria-label="Filter by team"
              >
                <option value="">All teams</option>
                {data.teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            ) : null}
            {can('roster:generate') ? (
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  setForm((f) => ({ ...f, teamId: data.teams[0]?.id ?? '' }));
                  setGenerateOpen(true);
                }}
              >
                Generate roster
              </button>
            ) : null}
            {can('employee:read') ? (
              <Link to="/employees" className="btn-secondary">
                Manage employees
              </Link>
            ) : null}
          </>
        }
      />

      {!data.hasRosterForToday ? (
        <div className="card mb-6 border-amber-200 bg-amber-50 px-5 py-4">
          <p className="text-sm font-medium text-amber-900">
            No roster covers {formatDate(data.date)}
          </p>
          <p className="mt-1 text-sm text-amber-800">
            Coverage figures below are unavailable until a roster exists for today. Generate and
            publish one to start tracking live coverage.
          </p>
        </div>
      ) : null}

      <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total employees" value={metrics.totalEmployees} />
        <StatCard
          label="Active employees"
          value={metrics.activeEmployees}
          hint={`${metrics.totalEmployees - metrics.activeEmployees} inactive`}
        />
        <StatCard
          label="Scheduled today"
          value={metrics.scheduledToday}
          hint={data.hasRosterForToday ? undefined : 'No roster for today'}
        />
        <StatCard label="On leave today" value={metrics.onLeaveToday} />
        <StatCard
          label="Open positions"
          value={show(metrics.openPositions)}
          tone={metrics.openPositions ? 'bad' : 'good'}
          hint="Shortfall against minimum staffing"
        />
        <StatCard
          label="Coverage"
          value={show(metrics.coveragePercentage, '%')}
          tone={coverageTone(metrics.coveragePercentage)}
        />
        <StatCard
          label="Shift lead coverage"
          value={show(metrics.shiftLeadCoverage, '%')}
          tone={coverageTone(metrics.shiftLeadCoverage)}
          hint="Target 100%"
        />
        <StatCard
          label="Core resource coverage"
          value={show(metrics.coreResourceCoverage, '%')}
          tone={coverageTone(metrics.coreResourceCoverage)}
          hint="Target 100%"
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card overflow-hidden">
          <header className="border-b border-slate-200 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Today by shift</h2>
          </header>
          {data.coverageByShift.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">
              No active shifts are configured.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.coverageByShift.map((row) => {
                const ratio = row.required === 0 ? 1 : row.assigned / row.required;
                return (
                  <div key={row.shiftCode} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-slate-800">{row.shiftCode}</span>
                      <span className="text-sm tabular-nums text-slate-600">
                        {row.assigned} / {row.required}
                        <span className="text-slate-400"> (max {row.maxStaff})</span>
                      </span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${
                          ratio >= 1 ? 'bg-emerald-500' : ratio >= 0.9 ? 'bg-amber-500' : 'bg-rose-500'
                        }`}
                        style={{ width: `${Math.min(100, ratio * 100)}%` }}
                      />
                    </div>
                    <div className="mt-2 flex gap-4 text-xs text-slate-500">
                      <span
                        className={
                          row.shiftLeadsAssigned < row.shiftLeadsRequired ? 'text-rose-600' : ''
                        }
                      >
                        Leads {row.shiftLeadsAssigned}/{row.shiftLeadsRequired}
                      </span>
                      <span className={row.coreAssigned < row.coreRequired ? 'text-rose-600' : ''}>
                        Core {row.coreAssigned}/{row.coreRequired}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="card overflow-hidden">
          <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Recent rosters</h2>
            {can('roster:read:all') ? (
              <Link to="/roster" className="text-sm text-slate-500 hover:text-slate-900">
                View all
              </Link>
            ) : null}
          </header>
          {data.recentRosters.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">
              No rosters have been created yet.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.recentRosters.map((roster) => (
                <Link
                  key={roster.id}
                  to={`/roster/${roster.id}`}
                  className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-800">{roster.label}</p>
                    <p className="text-xs text-slate-500">{roster.team}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {roster.validation && roster.validation.criticalCount > 0 ? (
                      <span className="badge bg-rose-100 text-rose-700">
                        {roster.validation.criticalCount} critical
                      </span>
                    ) : null}
                    <span className={`badge ${STATUS_STYLES[roster.status]}`}>
                      {statusLabel(roster.status)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {generateOpen ? (
        <Modal
          title="Generate roster"
          onClose={() => setGenerateOpen(false)}
          footer={
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setGenerateOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!form.teamId || generate.isPending}
                onClick={() => generate.mutate(form)}
              >
                {generate.isPending ? 'Generating…' : 'Generate'}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              The engine honours approved leave, weekly offs, rest periods, shift stability and
              the capacity plan. Manual edits you locked earlier are preserved.
            </p>
            <div>
              <label className="label" htmlFor="gen-team">
                Team
              </label>
              <select
                id="gen-team"
                className="input"
                value={form.teamId}
                onChange={(event) => setForm({ ...form, teamId: event.target.value })}
              >
                <option value="">Select a team…</option>
                {data.teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="gen-month">
                  Month
                </label>
                <select
                  id="gen-month"
                  className="input"
                  value={form.month}
                  onChange={(event) => setForm({ ...form, month: Number(event.target.value) })}
                >
                  {MONTHS.map((name, index) => (
                    <option key={name} value={index + 1}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="gen-year">
                  Year
                </label>
                <input
                  id="gen-year"
                  type="number"
                  className="input"
                  value={form.year}
                  min={2000}
                  max={2100}
                  onChange={(event) => setForm({ ...form, year: Number(event.target.value) })}
                />
              </div>
            </div>
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              An existing draft for this month will be replaced. A published roster must be
              withdrawn first.
            </p>
          </div>
        </Modal>
      ) : null}

      {toast ? <Toast {...toast} onDismiss={() => setToast(null)} /> : null}
    </>
  );
}
