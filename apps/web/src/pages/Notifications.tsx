import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { EmptyState, ErrorNotice, PageHeader, Spinner } from '../components/ui';
import { formatDateTime } from '../lib/format';
import type { NotificationItem } from '../lib/types';

interface NotificationsResponse {
  notifications: NotificationItem[];
  unreadCount: number;
  channels: Array<{ name: string; enabled: boolean }>;
}

export function Notifications() {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<NotificationsResponse>('/notifications'),
  });

  const markAll = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  if (isLoading) return <Spinner label="Loading notifications" />;
  if (error) return <ErrorNotice error={error} onRetry={refetch} />;

  const disabled = (data?.channels ?? []).filter((channel) => !channel.enabled);

  return (
    <>
      <PageHeader
        title="Notifications"
        description={`${data?.unreadCount ?? 0} unread`}
        actions={
          (data?.unreadCount ?? 0) > 0 ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              Mark all as read
            </button>
          ) : null
        }
      />

      {disabled.length > 0 ? (
        <div className="card mb-4 border-slate-200 bg-slate-50 px-5 py-3 text-sm text-slate-600">
          Delivered in-app only. {disabled.map((c) => c.name).join(', ')} are defined as channel
          adapters but not configured in this environment — see docs/integrations.md.
        </div>
      ) : null}

      {!data || data.notifications.length === 0 ? (
        <EmptyState
          title="Nothing yet"
          description="Roster publications, leave decisions and coverage alerts arrive here."
        />
      ) : (
        <div className="card divide-y divide-slate-100">
          {data.notifications.map((notification) => (
            <div
              key={notification.id}
              className={`px-5 py-3 ${notification.isRead ? '' : 'bg-sky-50/60'}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-800">{notification.title}</p>
                <p className="text-xs text-slate-500">{formatDateTime(notification.createdAt)}</p>
              </div>
              <p className="mt-1 text-sm text-slate-600">{notification.body}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
