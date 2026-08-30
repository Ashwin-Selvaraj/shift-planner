import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import { EmptyState, ErrorNotice, PageHeader, Spinner, StatCard } from '../components/ui';
import { ISSUE_LABELS, formatDate } from '../lib/format';
import type { RosterSummary } from '../lib/types';

type ReportTab = 'coverage' | 'utilization' | 'wellness' | 'distribution' | 'compliance';

const TABS: Array<{ id: ReportTab; label: string; description: string }> = [
  { id: 'coverage', label: 'Coverage', description: 'Required versus assigned resources' },
  { id: 'utilization', label: 'Utilization', description: 'Worked, leave and off days' },
  { id: 'wellness', label: 'Wellness', description: 'Consecutive days, night shifts, holiday work' },
  { id: 'distribution', label: 'Shift distribution', description: 'Shift counts per employee' },
  { id: 'compliance', label: 'Compliance', description: 'Violations, exceptions and resolution' },
];

/**
 * Charts render their final state immediately rather than animating in.
 * Recharts animates bar height from zero via requestAnimationFrame, and any
 * context where rAF is throttled — a background tab, printing, a screenshot —
 * leaves the animation stuck near frame one and the chart looking empty. Data
 * that only appears if an animation completes is not data a report can rely on.
 */

/** Shift colours match the roster grid so the two read as one system. */
const SHIFT_COLOURS: Record<string, string> = {
  S1: '#0891b2',
  S2: '#d97706',
  S3: '#7c3aed',
};
const FALLBACK_COLOURS = ['#0891b2', '#d97706', '#7c3aed', '#059669', '#dc2626'];

/** Reporting and analytics (BRD section 27). */
export function Reports() {
  const [tab, setTab] = useState<ReportTab>('coverage');
  const [rosterId, setRosterId] = useState('');

  const rostersQuery = useQuery({
    queryKey: ['rosters'],
    queryFn: () => api<RosterSummary[]>('/rosters'),
  });

  const rosters = rostersQuery.data ?? [];
  const selected = rosterId || rosters[0]?.id || '';

  const reportQuery = useQuery({
    queryKey: ['report', tab, selected],
    queryFn: () => api<Record<string, unknown>>(`/reports/${tab}/${selected}`),
    enabled: Boolean(selected),
  });

  if (rostersQuery.isLoading) return <Spinner label="Loading reports" />;
  if (rostersQuery.error) return <ErrorNotice error={rostersQuery.error} onRetry={rostersQuery.refetch} />;

  if (rosters.length === 0) {
    return (
      <>
        <PageHeader title="Reports" />
        <EmptyState
          title="No rosters to report on"
          description="Generate a roster first; every report is derived from one."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Reports"
        description={TABS.find((t) => t.id === tab)?.description}
        actions={
          <select
            className="input w-auto"
            value={selected}
            onChange={(event) => setRosterId(event.target.value)}
            aria-label="Select roster"
          >
            {rosters.map((roster) => (
              <option key={roster.id} value={roster.id}>
                {roster.label} — {roster.team?.name}
              </option>
            ))}
          </select>
        }
      />

      <div className="card mb-4 flex flex-wrap gap-1 p-1.5">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              tab === entry.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {reportQuery.isLoading ? (
        <Spinner label="Building report" />
      ) : reportQuery.error ? (
        <ErrorNotice error={reportQuery.error} onRetry={reportQuery.refetch} />
      ) : (
        <ReportBody tab={tab} data={reportQuery.data ?? {}} />
      )}
    </>
  );
}

function ReportBody({ tab, data }: { tab: ReportTab; data: Record<string, unknown> }) {
  switch (tab) {
    case 'coverage':
      return <CoverageReport data={data} />;
    case 'utilization':
      return <UtilizationReport data={data} />;
    case 'wellness':
      return <WellnessReport data={data} />;
    case 'distribution':
      return <DistributionReport data={data} />;
    case 'compliance':
      return <ComplianceReport data={data} />;
    default:
      return null;
  }
}

function CoverageReport({ data }: { data: Record<string, unknown> }) {
  const rows = (data.rows ?? []) as Array<{
    date: string;
    shiftCode: string;
    required: number;
    assigned: number;
    shiftLeadsAssigned: number;
    shiftLeadsRequired: number;
    coreAssigned: number;
    coreRequired: number;
    status: string;
  }>;
  const summary = data.summary as
    | { total: number; covered: number; underStaffed: number; missingRole: number; coveragePercentage: number }
    | undefined;

  /** Aggregated per shift; the day-level detail lives in the table below. */
  const chartData = useMemo(() => {
    const map = new Map<string, { shift: string; required: number; assigned: number }>();
    for (const row of rows) {
      const entry = map.get(row.shiftCode) ?? { shift: row.shiftCode, required: 0, assigned: 0 };
      entry.required += row.required;
      entry.assigned += row.assigned;
      map.set(row.shiftCode, entry);
    }
    return [...map.values()];
  }, [rows]);

  const problems = rows.filter((row) => row.status !== 'COVERED');

  return (
    <div className="space-y-4">
      {summary ? (
        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard label="Shift-days" value={summary.total} />
          <StatCard label="Fully covered" value={summary.covered} tone="good" />
          <StatCard
            label="Under staffed"
            value={summary.underStaffed}
            tone={summary.underStaffed ? 'bad' : 'good'}
          />
          <StatCard
            label="Missing lead or core"
            value={summary.missingRole}
            tone={summary.missingRole ? 'bad' : 'good'}
          />
        </div>
      ) : null}

      <div className="card px-5 py-4">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">
          Required versus assigned, by shift
        </h2>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="shift" stroke="#64748b" fontSize={12} />
            <YAxis stroke="#64748b" fontSize={12} />
            <Tooltip />
            <Legend />
            <Bar
              dataKey="required"
              name="Required"
              fill="#cbd5e1"
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
            <Bar
              dataKey="assigned"
              name="Assigned"
              fill="#0f172a"
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card overflow-hidden">
        <header className="border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            {problems.length === 0
              ? 'Every shift-day is fully covered'
              : `${problems.length} shift-day(s) need attention`}
          </h2>
        </header>
        {problems.length > 0 ? (
          <div className="max-h-96 overflow-y-auto thin-scroll">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className="th">Date</th>
                  <th className="th">Shift</th>
                  <th className="th">Staffed</th>
                  <th className="th">Leads</th>
                  <th className="th">Core</th>
                  <th className="th">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {problems.slice(0, 200).map((row) => (
                  <tr key={`${row.date}-${row.shiftCode}`}>
                    <td className="td whitespace-nowrap">{formatDate(row.date)}</td>
                    <td className="td font-medium">{row.shiftCode}</td>
                    <td className="td tabular-nums">
                      {row.assigned} / {row.required}
                    </td>
                    <td className="td tabular-nums">
                      {row.shiftLeadsAssigned} / {row.shiftLeadsRequired}
                    </td>
                    <td className="td tabular-nums">
                      {row.coreAssigned} / {row.coreRequired}
                    </td>
                    <td className="td">
                      <span className="badge bg-rose-100 text-rose-700">
                        {row.status.replace(/_/g, ' ').toLowerCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function UtilizationReport({ data }: { data: Record<string, unknown> }) {
  const rows = (data.rows ?? []) as Array<{
    employeeId: string;
    employeeCode: string;
    name: string;
    team: string;
    workedDays: number;
    leaveDays: number;
    offDays: number;
    holidayDays: number;
    utilizationPercentage: number;
  }>;

  return (
    <div className="card overflow-hidden">
      <div className="max-h-[32rem] overflow-y-auto thin-scroll">
        <table className="min-w-full divide-y divide-slate-100">
          <thead className="sticky top-0 bg-slate-50">
            <tr>
              <th className="th">Employee</th>
              <th className="th">Team</th>
              <th className="th">Worked</th>
              <th className="th">Leave</th>
              <th className="th">Off</th>
              <th className="th">Holiday</th>
              <th className="th">Utilisation</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.employeeId} className="hover:bg-slate-50">
                <td className="td">
                  <p className="font-medium text-slate-800">{row.name}</p>
                  <p className="text-xs text-slate-500">{row.employeeCode}</p>
                </td>
                <td className="td text-slate-500">{row.team}</td>
                <td className="td tabular-nums">{row.workedDays}</td>
                <td className="td tabular-nums">{row.leaveDays}</td>
                <td className="td tabular-nums">{row.offDays}</td>
                <td className="td tabular-nums">{row.holidayDays}</td>
                <td className="td">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-slate-900"
                        style={{ width: `${Math.min(100, row.utilizationPercentage)}%` }}
                      />
                    </div>
                    <span className="tabular-nums text-xs text-slate-600">
                      {row.utilizationPercentage}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WellnessReport({ data }: { data: Record<string, unknown> }) {
  const rows = (data.rows ?? []) as Array<{
    employeeId: string;
    employeeCode: string;
    name: string;
    maxConsecutiveDays: number;
    nightShifts: number;
    holidaysWorked: number;
    weeklyOffs: number;
    status: 'HEALTHY' | 'REVIEW' | 'BREACH';
  }>;
  const summary = data.summary as
    | { healthy: number; review: number; breach: number; compliancePercentage: number }
    | undefined;

  const tone: Record<string, string> = {
    HEALTHY: 'bg-emerald-100 text-emerald-700',
    REVIEW: 'bg-amber-100 text-amber-700',
    BREACH: 'bg-rose-100 text-rose-700',
  };

  return (
    <div className="space-y-4">
      {summary ? (
        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard label="Healthy" value={summary.healthy} tone="good" />
          <StatCard label="Needs review" value={summary.review} tone="warn" />
          <StatCard label="Breach" value={summary.breach} tone={summary.breach ? 'bad' : 'good'} />
          <StatCard
            label="Wellness compliance"
            value={`${summary.compliancePercentage}%`}
            hint="Target 95%"
            tone={summary.compliancePercentage >= 95 ? 'good' : 'warn'}
          />
        </div>
      ) : null}

      <div className="card overflow-hidden">
        <div className="max-h-[28rem] overflow-y-auto thin-scroll">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                <th className="th">Employee</th>
                <th className="th">Longest run</th>
                <th className="th">Night shifts</th>
                <th className="th">Holidays worked</th>
                <th className="th">Weekly offs</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...rows]
                .sort((a, b) => b.maxConsecutiveDays - a.maxConsecutiveDays)
                .map((row) => (
                  <tr key={row.employeeId} className="hover:bg-slate-50">
                    <td className="td">
                      <p className="font-medium text-slate-800">{row.name}</p>
                      <p className="text-xs text-slate-500">{row.employeeCode}</p>
                    </td>
                    <td className="td tabular-nums">{row.maxConsecutiveDays} days</td>
                    <td className="td tabular-nums">{row.nightShifts}</td>
                    <td className="td tabular-nums">{row.holidaysWorked}</td>
                    <td className="td tabular-nums">{row.weeklyOffs}</td>
                    <td className="td">
                      <span className={`badge ${tone[row.status]}`}>
                        {row.status.charAt(0) + row.status.slice(1).toLowerCase()}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DistributionReport({ data }: { data: Record<string, unknown> }) {
  const shiftCodes = (data.shiftCodes ?? []) as string[];
  const totals = (data.totals ?? {}) as Record<string, number>;
  const rows = (data.rows ?? []) as Array<{
    employeeId: string;
    employeeCode: string;
    name: string;
    counts: Record<string, number>;
    total: number;
  }>;

  const pieData = shiftCodes.map((code) => ({ name: code, value: totals[code] ?? 0 }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card px-5 py-4">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Overall shift mix</h2>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                innerRadius={60}
                outerRadius={95}
                paddingAngle={2}
                isAnimationActive={false}
                label={(entry: { name?: string; value?: number }) =>
                  `${entry.name}: ${entry.value}`
                }
              >
                {pieData.map((entry, index) => (
                  <Cell
                    key={entry.name}
                    fill={
                      SHIFT_COLOURS[entry.name] ??
                      FALLBACK_COLOURS[index % FALLBACK_COLOURS.length]
                    }
                  />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="card px-5 py-4">
          <h2 className="mb-4 text-sm font-semibold text-slate-900">Total assignments per shift</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={pieData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
              <YAxis stroke="#64748b" fontSize={12} />
              <Tooltip />
              <Bar dataKey="value" name="Assignments" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {pieData.map((entry, index) => (
                  <Cell
                    key={entry.name}
                    fill={
                      SHIFT_COLOURS[entry.name] ??
                      FALLBACK_COLOURS[index % FALLBACK_COLOURS.length]
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="max-h-96 overflow-y-auto thin-scroll">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                <th className="th">Employee</th>
                {shiftCodes.map((code) => (
                  <th key={code} className="th">
                    {code}
                  </th>
                ))}
                <th className="th">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.employeeId} className="hover:bg-slate-50">
                  <td className="td">
                    <p className="font-medium text-slate-800">{row.name}</p>
                    <p className="text-xs text-slate-500">{row.employeeCode}</p>
                  </td>
                  {shiftCodes.map((code) => (
                    <td key={code} className="td tabular-nums">
                      {row.counts[code] ?? 0}
                    </td>
                  ))}
                  <td className="td font-medium tabular-nums">{row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ComplianceReport({ data }: { data: Record<string, unknown> }) {
  const summary = (data.summary ?? []) as Array<{
    code: string;
    severity: 'CRITICAL' | 'WARNING';
    count: number;
  }>;
  const issues = (data.issues ?? []) as Array<{
    code: string;
    severity: string;
    message: string;
    date?: string;
  }>;
  const criticalCount = (data.criticalCount ?? 0) as number;
  const warningCount = (data.warningCount ?? 0) as number;
  const canPublish = Boolean(data.canPublish);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Critical violations"
          value={criticalCount}
          tone={criticalCount ? 'bad' : 'good'}
          hint="Block publication"
        />
        <StatCard label="Warnings" value={warningCount} tone={warningCount ? 'warn' : 'good'} />
        <StatCard
          label="Publication"
          value={canPublish ? 'Allowed' : 'Blocked'}
          tone={canPublish ? 'good' : 'bad'}
        />
      </div>

      {summary.length > 0 ? (
        <div className="card px-5 py-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Violations by rule</h2>
          <div className="space-y-2">
            {summary.map((entry) => (
              <div key={entry.code} className="flex items-center gap-3">
                <span
                  className={`badge w-52 shrink-0 justify-start ${
                    entry.severity === 'CRITICAL'
                      ? 'bg-rose-100 text-rose-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {ISSUE_LABELS[entry.code] ?? entry.code}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${
                      entry.severity === 'CRITICAL' ? 'bg-rose-500' : 'bg-amber-500'
                    }`}
                    style={{
                      width: `${Math.min(
                        100,
                        (entry.count / Math.max(1, summary[0]?.count ?? 1)) * 100,
                      )}%`,
                    }}
                  />
                </div>
                <span className="w-10 text-right text-sm tabular-nums text-slate-600">
                  {entry.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState
          title="No violations"
          description="Every wellness and coverage rule passes for this roster."
        />
      )}

      {issues.length > 0 ? (
        <div className="card overflow-hidden">
          <header className="border-b border-slate-200 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Detail</h2>
          </header>
          <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto thin-scroll">
            {issues.slice(0, 300).map((issue, index) => (
              <div key={`${issue.code}-${index}`} className="flex items-start gap-3 px-5 py-2">
                <span
                  className={`badge shrink-0 ${
                    issue.severity === 'CRITICAL'
                      ? 'bg-rose-100 text-rose-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {ISSUE_LABELS[issue.code] ?? issue.code}
                </span>
                <span className="text-sm text-slate-600">{issue.message}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
