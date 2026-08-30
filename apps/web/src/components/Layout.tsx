import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { ROLE_LABELS } from '../lib/format';
import { useSession } from '../hooks/useSession';
import type { NotificationItem } from '../lib/types';

interface NavItem {
  to: string;
  label: string;
  /** Hidden unless the signed-in role holds this permission (BRD section 6). */
  permission: string;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', permission: 'dashboard:read' },
  { to: '/roster', label: 'Roster Planning', permission: 'roster:read:all' },
  { to: '/my-schedule', label: 'My Schedule', permission: 'roster:read' },
  { to: '/employees', label: 'Employees', permission: 'employee:read' },
  { to: '/leave', label: 'Leave', permission: 'leave:read' },
  { to: '/holidays', label: 'Holidays', permission: 'holiday:read' },
  { to: '/reports', label: 'Reports', permission: 'report:read' },
  { to: '/settings', label: 'Settings', permission: 'shift:read' },
  { to: '/audit', label: 'Audit Trail', permission: 'audit:read' },
];

export function Layout() {
  const { user, signOut, can } = useSession();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const { data: notifications } = useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      api<{ notifications: NotificationItem[]; unreadCount: number }>('/notifications'),
    enabled: can('notification:read'),
    refetchInterval: 60_000,
  });

  const visible = NAV.filter((item) => can(item.permission));

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      {/* Sidebar collapses to a top bar on tablets and phones (BRD 29). */}
      <aside className="border-b border-slate-200 bg-white lg:h-screen lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <p className="text-sm font-semibold tracking-tight text-slate-900">Shift Planner</p>
            <p className="text-xs text-slate-500">Workforce scheduling</p>
          </div>
          <button
            type="button"
            className="btn-secondary px-2 py-1 lg:hidden"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-label="Toggle navigation"
          >
            ☰
          </button>
        </div>

        <nav className={`${menuOpen ? 'block' : 'hidden'} px-3 pb-4 lg:block`}>
          {visible.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                `mb-0.5 block rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-4 border-b border-slate-200 bg-white px-5 py-3">
          {can('notification:read') ? (
            <button
              type="button"
              className="relative rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100"
              onClick={() => navigate('/notifications')}
              aria-label={`Notifications (${notifications?.unreadCount ?? 0} unread)`}
            >
              🔔
              {notifications && notifications.unreadCount > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
                  {notifications.unreadCount > 9 ? '9+' : notifications.unreadCount}
                </span>
              ) : null}
            </button>
          ) : null}

          <div className="text-right">
            <p className="text-sm font-medium text-slate-900">{user?.name}</p>
            <p className="text-xs text-slate-500">
              {user ? ROLE_LABELS[user.role] : ''}
            </p>
          </div>
          <button type="button" className="btn-secondary" onClick={signOut}>
            Sign out
          </button>
        </header>

        <main className="min-w-0 flex-1 px-5 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
