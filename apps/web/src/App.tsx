import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { SessionProvider, useSession } from './hooks/useSession';
import { Spinner } from './components/ui';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { RosterList } from './pages/RosterList';
import { RosterPlanner } from './pages/RosterPlanner';
import { MySchedule } from './pages/MySchedule';
import { Employees } from './pages/Employees';
import { LeavePage } from './pages/Leave';
import { Holidays } from './pages/Holidays';

// Reports is the only screen that pulls in the charting library, and it is not
// on the path most users take. Splitting it out keeps roughly two thirds of the
// JavaScript off the initial load.
const Reports = lazy(() =>
  import('./pages/Reports').then((module) => ({ default: module.Reports })),
);
import { Settings } from './pages/Settings';
import { AuditTrail } from './pages/AuditTrail';
import { Notifications } from './pages/Notifications';

/** Blocks a route until the session resolves, then redirects if not signed in. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useSession();
  if (loading) return <Spinner label="Restoring your session" />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Hides a route the signed-in role has no permission for (BRD section 6). */
function RequirePermission({
  permission,
  children,
}: {
  permission: string;
  children: React.ReactNode;
}) {
  const { can } = useSession();
  if (!can(permission)) {
    return (
      <div className="card px-6 py-10 text-center">
        <p className="text-base font-medium text-slate-800">
          You do not have access to this area
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Your role does not include this permission. Contact an administrator if you need it.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

function Routing() {
  const { user, loading } = useSession();
  if (loading) return <Spinner label="Restoring your session" />;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route
          path="roster"
          element={
            <RequirePermission permission="roster:read:all">
              <RosterList />
            </RequirePermission>
          }
        />
        <Route
          path="roster/:id"
          element={
            <RequirePermission permission="roster:read:all">
              <RosterPlanner />
            </RequirePermission>
          }
        />
        <Route path="my-schedule" element={<MySchedule />} />
        <Route
          path="employees"
          element={
            <RequirePermission permission="employee:read">
              <Employees />
            </RequirePermission>
          }
        />
        <Route
          path="leave"
          element={
            <RequirePermission permission="leave:read">
              <LeavePage />
            </RequirePermission>
          }
        />
        <Route
          path="holidays"
          element={
            <RequirePermission permission="holiday:read">
              <Holidays />
            </RequirePermission>
          }
        />
        <Route
          path="reports"
          element={
            <RequirePermission permission="report:read">
              <Suspense fallback={<Spinner label="Loading reports" />}>
                <Reports />
              </Suspense>
            </RequirePermission>
          }
        />
        <Route
          path="settings"
          element={
            <RequirePermission permission="shift:read">
              <Settings />
            </RequirePermission>
          }
        />
        <Route
          path="audit"
          element={
            <RequirePermission permission="audit:read">
              <AuditTrail />
            </RequirePermission>
          }
        />
        <Route path="notifications" element={<Notifications />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Routing />
      </SessionProvider>
    </BrowserRouter>
  );
}
