import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { EmptyState, ErrorNotice, PageHeader, Spinner } from '../components/ui';
import { STATUS_STYLES, formatDate, statusLabel } from '../lib/format';
import type { RosterSummary } from '../lib/types';

export function RosterList() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['rosters'],
    queryFn: () => api<RosterSummary[]>('/rosters'),
  });

  if (isLoading) return <Spinner label="Loading rosters" />;
  if (error) return <ErrorNotice error={error} onRetry={refetch} />;

  return (
    <>
      <PageHeader
        title="Roster planning"
        description="Every monthly roster, with its validation state"
      />
      {!data || data.length === 0 ? (
        <EmptyState
          title="No rosters yet"
          description="Generate one from the dashboard to get started."
          action={
            <Link to="/" className="btn-primary">
              Go to dashboard
            </Link>
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto thin-scroll">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Period</th>
                  <th className="th">Team</th>
                  <th className="th">Dates</th>
                  <th className="th">Status</th>
                  <th className="th">Validation</th>
                  <th className="th">Assignments</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((roster) => (
                  <tr key={roster.id} className="hover:bg-slate-50">
                    <td className="td font-medium">
                      <Link to={`/roster/${roster.id}`} className="hover:underline">
                        {roster.label}
                      </Link>
                    </td>
                    <td className="td">{roster.team?.name}</td>
                    <td className="td text-slate-500">
                      {formatDate(roster.startDate)} – {formatDate(roster.endDate)}
                    </td>
                    <td className="td">
                      <span className={`badge ${STATUS_STYLES[roster.status]}`}>
                        {statusLabel(roster.status)}
                      </span>
                    </td>
                    <td className="td">
                      {roster.validation ? (
                        <span className="flex flex-wrap gap-1.5">
                          {roster.validation.criticalCount > 0 ? (
                            <span className="badge bg-rose-100 text-rose-700">
                              {roster.validation.criticalCount} critical
                            </span>
                          ) : (
                            <span className="badge bg-emerald-100 text-emerald-700">Clear</span>
                          )}
                          {roster.validation.warningCount > 0 ? (
                            <span className="badge bg-amber-100 text-amber-700">
                              {roster.validation.warningCount} warnings
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-slate-400">Not validated</span>
                      )}
                    </td>
                    <td className="td tabular-nums text-slate-500">
                      {roster._count?.assignments ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
