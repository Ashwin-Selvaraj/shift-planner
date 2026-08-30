# Integrations

BRD section 30 lists four external integrations and section 31 specifies SSO and
MFA. None are built. This document is what each one needs, so the work is scoped
rather than guessed at.

**A note on why they are absent rather than stubbed.** A sign-in button that
looks like SSO but authenticates locally, or a notification channel that logs
and returns success, both demo perfectly and fail in production — and they fail
silently, which is worse. Each unbuilt integration is either absent or reports
itself as unconfigured.

---

## Microsoft Entra ID — authentication (§30, §31)

**Needed:** SSO and MFA.

**Current state:** local user store, bcrypt-hashed passwords, JWT sessions.
`apps/api/src/routes/auth.ts` is the only place that mints a token.

**To integrate:** add an OIDC authorization-code flow with PKCE against the
tenant. On callback, match the verified `email` claim to a `User`, then issue
the same internal JWT the rest of the API already expects, so no route changes.
MFA is enforced by Entra Conditional Access, not by this application.

**Decide first:** whether an Entra identity with no matching `User` row is
rejected or provisioned on first sign-in, and how Entra groups map to the five
roles in BRD 6. Both are policy questions, not technical ones.

---

## HRMS — employee synchronisation (§30)

**Current state:** the same need is met manually by the XLSX/CSV upload, which
already matches on `employeeId`, updates existing records, creates teams and
locations on demand, and resolves reporting lines in a second pass.

**To integrate:** a scheduled job calling the HRMS employee endpoint and feeding
the result through the same upsert path the upload uses. The parsing and
validation in `apps/api/src/services/employee-import.ts` is already separated
from the HTTP layer and can be called directly.

**Decide first:** which system owns each field. If HRMS owns `role` and `team`,
a sync will overwrite local edits — that is usually correct, but it must be
stated. `isCoreResource` and `shiftPreference` are scheduling concepts an HRMS
usually does not hold, so they most likely stay local and must be excluded from
the overwrite.

---

## Leave management system — leave import (§30)

**Current state:** leave is created in-app with a full approval workflow.
Only `APPROVED` leave affects roster generation and validation.

**To integrate:** import approved leave into the `Leave` table, then re-validate
any affected roster. An import that lands on an already-published roster must
raise the `MISSING_COVERAGE` notification rather than silently leaving a shift
short.

**Decide first:** whether imported leave can invalidate a published roster
automatically, or whether it queues for a planner. The system supports either —
`POST /api/rosters/:id/withdraw` exists and is audited — but which one happens
is a business decision.

---

## Microsoft Teams — notifications and roster sharing (§30, §26)

**Current state:** `apps/api/src/services/notifications.ts` defines a
`NotificationChannel` interface. In-app delivery is implemented and persisted.
Email, mobile push and Teams are registered with `enabled: false`; they log
their intent and the UI states that delivery was in-app only.

**To integrate:** implement `NotificationChannel` for the provider and register
it in the `channels` array. No caller changes — every notification already goes
through `notify()`.

```ts
export const teamsChannel: NotificationChannel = {
  name: 'microsoft-teams',
  enabled: true,
  async send(payload) {
    // POST an Adaptive Card to the configured webhook or Graph endpoint.
  },
};
```

**Decide first:** Teams delivery is per-user; the payload carries `userIds`, so
a mapping from internal user to Teams identity is required. If it comes from
Entra, do that integration first.

---

## Email and mobile push (§26)

Both are registered adapters awaiting an implementation, exactly as Teams is.

Email needs a transactional provider and templates for the five notification
types. Push needs device-token registration, which in turn needs the native
mobile apps from BRD 29 — so it is blocked on that deliverable, not on this one.

---

## Encryption at rest (§31)

A deployment concern rather than an application one, and correctly handled
there: managed database encryption, encrypted volumes, and a secrets manager for
`JWT_SECRET` and `DATABASE_URL`. Encryption in transit is TLS terminated at the
load balancer or reverse proxy.

The application does not implement its own cryptography beyond password hashing,
which is deliberate.
