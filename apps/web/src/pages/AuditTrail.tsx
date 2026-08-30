import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { EmptyState, ErrorNotice, PageHeader, Spinner } from '../components/ui';
import { formatDateTime } from '../lib/format';
import type { AuditEntry } from '../lib/types';

interface AuditResponse {
  entries: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Audit trail (BRD section 28): user, timestamp, previous value, new value, reason. */
export function AuditTrail() {
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['audit', page, entity],
    queryFn: () =>
      api<AuditResponse>(`/audit?page=${page}&pageSize=25${entity ? `&entity=${entity}` : ''}`),
  });

  if (isLoading) return <Spinner label="Loading audit trail" />;
  if (error) return <ErrorNotice error={error} onRetry={refetch} />;

  const summarise = (value?: string | null) => {
    if (!value) return '—';
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return Object.entries(parsed)
        .slice(0, 3)
        .map(([key, val]) => `${key}: ${String(val).slice(0, 30)}`)
        .join(', ');
    } catch {
      return value.slice(0, 60);
    }
  };

  return (
    <>
      <PageHeader
        title="Audit trail"
        description={`${data?.total ?? 0} entries. Retained for seven years.`}
        actions={
          <select
            className="input w-auto"
            value={entity}
            onChange={(event) => {
              setEntity(event.target.value);
              setPage(1);
            }}
            aria-label="Filter by entity"
          >
            <option value="">All entities</option>
            {['Roster', 'Assignment', 'Employee', 'Leave', 'Shift', 'Holiday', 'User'].map(
              (value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ),
            )}
          </select>
        }
      />

      {!data || data.entries.length === 0 ? (
        <EmptyState title="No audit entries match this filter" />
      ) : (
        <>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto thin-scroll">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="th">When</th>
                    <th className="th">User</th>
                    <th className="th">Action</th>
                    <th className="th">Entity</th>
                    <th className="th">Previous</th>
                    <th className="th">Updated</th>
                    <th className="th">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50">
                      <td className="td whitespace-nowrap text-slate-500">
                        {formatDateTime(entry.createdAt)}
                      </td>
                      <td className="td font-medium">{entry.userName}</td>
                      <td className="td">
                        <span className="badge bg-slate-100 text-slate-700">{entry.action}</span>
                      </td>
                      <td className="td">{entry.entity}</td>
                      <td className="td max-w-48 truncate text-slate-500">
                        {summarise(entry.previousValue)}
                      </td>
                      <td className="td max-w-48 truncate text-slate-500">
                        {summarise(entry.updatedValue)}
                      </td>
                      <td className="td max-w-48 truncate text-slate-500">{entry.reason ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-slate-500">
              Page {data.page} of {data.totalPages}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={page >= data.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
