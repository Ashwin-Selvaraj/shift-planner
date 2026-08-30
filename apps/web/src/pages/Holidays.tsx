import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useSession } from '../hooks/useSession';
import { EmptyState, ErrorNotice, Modal, PageHeader, Spinner, Toast } from '../components/ui';
import { formatDate } from '../lib/format';
import type { Holiday, Location } from '../lib/types';

/** Location-specific holiday calendars (BRD section 22). */
export function Holidays() {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const [locationFilter, setLocationFilter] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  const holidaysQuery = useQuery({
    queryKey: ['holidays'],
    queryFn: () => api<Holiday[]>('/holidays'),
  });
  const locationsQuery = useQuery({
    queryKey: ['locations'],
    queryFn: () => api<Location[]>('/config/locations'),
  });

  const filtered = useMemo(
    () =>
      (holidaysQuery.data ?? []).filter(
        (holiday) => !locationFilter || holiday.locationId === locationFilter,
      ),
    [holidaysQuery.data, locationFilter],
  );

  /** Grouped by date so a planner can see which sites share a holiday. */
  const byDate = useMemo(() => {
    const map = new Map<string, Holiday[]>();
    for (const holiday of filtered) {
      map.set(holiday.date, [...(map.get(holiday.date) ?? []), holiday]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const remove = useMutation({
    mutationFn: (id: string) => api(`/holidays/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['holidays'] });
      setToast({ message: 'Holiday removed.', tone: 'success' });
    },
    onError: (caught) =>
      setToast({ message: caught instanceof Error ? caught.message : 'Failed', tone: 'error' }),
  });

  if (holidaysQuery.isLoading) return <Spinner label="Loading holidays" />;
  if (holidaysQuery.error) return <ErrorNotice error={holidaysQuery.error} onRetry={holidaysQuery.refetch} />;

  return (
    <>
      <PageHeader
        title="Holidays"
        description="Each location maintains an independent holiday calendar"
        actions={
          <>
            <select
              className="input w-auto"
              value={locationFilter}
              onChange={(event) => setLocationFilter(event.target.value)}
              aria-label="Filter by location"
            >
              <option value="">All locations</option>
              {(locationsQuery.data ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
            {can('holiday:write') ? (
              <button type="button" className="btn-primary" onClick={() => setAddOpen(true)}>
                Add holiday
              </button>
            ) : null}
          </>
        }
      />

      {byDate.length === 0 ? (
        <EmptyState title="No holidays configured" />
      ) : (
        <div className="card divide-y divide-slate-100">
          {byDate.map(([date, entries]) => (
            <div key={date} className="flex flex-wrap items-start gap-4 px-5 py-3">
              <div className="w-40 shrink-0">
                <p className="text-sm font-medium text-slate-800">{formatDate(date)}</p>
              </div>
              <div className="flex flex-1 flex-wrap gap-2">
                {entries.map((holiday) => (
                  <span
                    key={holiday.id}
                    className="inline-flex items-center gap-2 rounded-full bg-violet-50 py-1 pl-3 pr-2 text-sm text-violet-800"
                  >
                    {holiday.location?.name ?? '—'}: {holiday.name}
                    {can('holiday:write') ? (
                      <button
                        type="button"
                        className="rounded-full px-1 text-violet-500 hover:bg-violet-100 hover:text-violet-800"
                        aria-label={`Remove ${holiday.name}`}
                        onClick={() => remove.mutate(holiday.id)}
                      >
                        ✕
                      </button>
                    ) : null}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {addOpen ? (
        <AddHolidayModal
          locations={locationsQuery.data ?? []}
          onClose={() => setAddOpen(false)}
          onDone={() => {
            setAddOpen(false);
            queryClient.invalidateQueries({ queryKey: ['holidays'] });
            setToast({ message: 'Holiday added.', tone: 'success' });
          }}
          onError={(message) => setToast({ message, tone: 'error' })}
        />
      ) : null}

      {toast ? <Toast {...toast} onDismiss={() => setToast(null)} /> : null}
    </>
  );
}

function AddHolidayModal({
  locations,
  onClose,
  onDone,
  onError,
}: {
  locations: Location[];
  onClose: () => void;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({ locationId: locations[0]?.id ?? '', date: '', name: '' });

  const create = useMutation({
    mutationFn: () => api('/holidays', { method: 'POST', body: form }),
    onSuccess: onDone,
    onError: (caught) =>
      onError(caught instanceof Error ? caught.message : 'Could not add the holiday'),
  });

  return (
    <Modal
      title="Add holiday"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!form.locationId || !form.date || !form.name || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Saving…' : 'Add'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="hol-location">
            Location
          </label>
          <select
            id="hol-location"
            className="input"
            value={form.locationId}
            onChange={(event) => setForm({ ...form, locationId: event.target.value })}
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="hol-date">
            Date
          </label>
          <input
            id="hol-date"
            type="date"
            className="input"
            value={form.date}
            onChange={(event) => setForm({ ...form, date: event.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="hol-name">
            Name
          </label>
          <input
            id="hol-name"
            className="input"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Republic Day"
          />
        </div>
      </div>
    </Modal>
  );
}
