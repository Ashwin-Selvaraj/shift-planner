# Shift Planner

A workforce scheduling and resource planning system: it builds a month of shift
assignments automatically, enforces workforce wellness and coverage rules, and
refuses to publish a roster that breaks them.

Built to the *Shift Planner Application — Business Requirements & Functional
Design Document (BRD/FRD) v2.0*. Section references throughout the code and docs
point back to that document.

---

## What it does

| Capability | Where |
|---|---|
| Auto-generate a month of assignments from the employee master, leave and holiday calendars | `packages/core/src/roster-engine.ts` |
| Block publication on critical rule violations, warn on the rest | `packages/core/src/validation-engine.ts` |
| Rank replacements when someone drops out of a shift | `suggestReplacements()` |
| Coverage, utilization, wellness, distribution and compliance reports | `packages/core/src/reports.ts` |
| Role-based access for five roles | `apps/api/src/lib/permissions.ts` |
| Employee master upload from XLSX or CSV | `apps/api/src/services/employee-import.ts` |
| Drag-and-drop roster planning across month, week and day views | `apps/web/src/pages/RosterPlanner.tsx` |

The scheduling rules live in a standalone package with no database or HTTP
dependency, so they are unit-testable in isolation and the web client can reuse
the exact code the server runs.

---

## Running it

Requires Node 20 or newer. No database server needed — it ships with SQLite.

```bash
git clone https://github.com/Ashwin-Selvaraj/shift-planner.git
```

```bash
cd shift-planner && cp apps/api/.env.example apps/api/.env && npm run setup
```

`npm run setup` installs dependencies, builds the rules package, creates the
database and loads demo data. Then start both services:

```bash
npm run dev
```

The app is at **http://localhost:5173**, the API at **http://localhost:4000**.

### Demo accounts

Every account uses the password `Password123!`.

| Email | Role | Can do |
|---|---|---|
| `admin@shiftplanner.app` | System Administrator | Everything, including configuration and audit |
| `manager1@shiftplanner.app` | Manager | Upload employees, generate, approve and publish rosters |
| `shiftlead1@shiftplanner.app` | Shift Lead | Create and modify rosters; no configuration, no publishing |
| `teamlead1@shiftplanner.app` | Team Lead | View the team schedule and reports |
| `member1@shiftplanner.app` | Team Member | View own schedule, request leave |

`manager2@`, `shiftlead2@`, `teamlead2@` and `member2@` cover the second team.

### A five-minute tour

1. Sign in as `manager1@shiftplanner.app`.
2. **Generate roster** on the dashboard — pick a team and month. A 50-person
   month generates in about 30 ms.
3. Open the roster. Drag `S1`/`S2`/`S3`/`O`/`L`/`H` from the palette onto any
   cell, or tap a cell to cycle through them. Validation re-runs on every edit.
4. Try moving someone from `S1` straight to `S3` — the planner asks for a
   management override reason before it will write it, and records that reason.
5. Take someone off a shift until it drops below its minimum. **Publish** now
   refuses, and tells you exactly which rule failed and where.
6. **Leave → Review** on a pending request shows which shifts the absence
   uncovers and ranks eligible stand-ins with the reasoning behind each.

---

## Commands

| Command | What it does |
|---|---|
| `npm run setup` | Install, build, migrate and seed — the one-liner for a fresh clone |
| `npm run dev` | Run API and web together |
| `npm test` | Run the scheduling rule test suite |
| `npm run build` | Type-check and build all three packages |
| `npm run typecheck` | Type-check without emitting |
| `npm run db:reset` | Drop and rebuild the database |
| `npm run db:seed` | Reload demo data |
| `npm run db:studio -w @shift-planner/api` | Browse the database |

---

## How it is put together

```
shift-planner/
├── packages/core/        Domain model, policy, validation and roster engines
│   └── src/
│       ├── policy.ts             Every wellness rule, as data
│       ├── shift-rules.ts        Rest periods, transitions, work streaks
│       ├── validation-engine.ts  Critical errors vs warnings (BRD 25)
│       ├── roster-engine.ts      Auto-roster and replacements (BRD 24)
│       └── reports.ts            The five reports (BRD 27)
├── apps/api/             Express + Prisma REST API
│   ├── prisma/           Schema and seed
│   └── src/
│       ├── lib/permissions.ts    The BRD 6 role matrix
│       ├── routes/               One module per resource
│       └── services/             Import, notifications, audit, policy
└── apps/web/             React + Vite client
    └── src/pages/        One module per screen
```

**Why the rules live in their own package.** Scheduling logic is the part of
this system that is expensive to get wrong and expensive to re-derive. Keeping
it free of database and HTTP concerns means it can be tested directly, reasoned
about on its own, and reused by the client without a round trip.

**Why the roster engine is a heuristic rather than a solver.** Hard constraints
(leave, one shift per day, the streak cap, restricted transitions, rest periods)
remove candidates outright; soft objectives (shift stability, fairness, stated
preference) rank whoever survives. Each day is filled leads first, then core
resources, then general headcount, because those two shortages are what block
publication. It is deterministic — the same inputs always produce the same
roster, so a planner can regenerate and diff with confidence — and it generates
a 10,000-employee month in about 3.5 seconds against the document's 60-second
budget.

**Why SQLite.** The project runs end to end with no external services. The
schema avoids SQLite-specific constructs, so moving to PostgreSQL means changing
the `provider` in `prisma/schema.prisma` and re-running the migration.

---

## The rules it enforces

Publication is blocked by any of these (BRD 25):

- A shift without its required shift lead or core resource
- Staffing below the minimum or above the maximum
- Someone assigned a shift while on approved leave
- Two shifts on the same day
- Seven consecutive working days
- A week with no rest day
- A restricted shift transition without a management override
- An inactive employee rostered

These warn but still allow publication:

- Six consecutive days (an exception under BRD 20)
- Excessive shift rotation within a week
- Less than the minimum rest between two shifts
- Workload noticeably uneven within a peer group
- A restricted transition that carries an approved override

Every threshold is editable under **Settings → Wellness policy** without a
redeploy.

---

## Testing

```bash
npm test
```

47 tests over the scheduling rules: date arithmetic across month, year and leap
boundaries; rest periods and transitions; work-streak detection; every critical
and warning path in the validation engine; and engine-level properties — one
assignment per person per day, no seven-day streak ever produced, nobody
rostered over approved leave, a weekly rest day in every full week,
determinism, and the 10,000-employee performance budget.

---

## Not built, and why

The document covers more than a web application. What is missing is missing
deliberately, and nothing here is faked.

| From the document | Status |
|---|---|
| Native Android and iOS apps (BRD 29) | Not built. The web client is responsive and works on phones and tablets, but native apps are a separate deliverable. |
| SSO and MFA via Microsoft Entra ID (BRD 31) | Not built. Authentication uses the local user store with bcrypt-hashed passwords and JWT sessions. See [docs/integrations.md](docs/integrations.md). |
| HRMS and leave-system sync (BRD 30) | Not built. The upload path covers the same need manually. |
| Email, push and Teams notifications (BRD 26) | In-app delivery is implemented. The other three exist as channel adapters that report themselves as unconfigured rather than silently dropping messages. |

A note on why that matters: a stubbed SSO button or a notification channel that
logs and returns success looks complete in a demo and fails in production. These
are surfaced in the UI as unconfigured instead.

---

## Documentation

- [Requirements traceability](docs/requirements-traceability.md) — every one of
  the document's 34 sections mapped to where it is implemented
- [Architecture](docs/architecture.md) — data model, request flow, engine design
- [Integrations](docs/integrations.md) — what each unbuilt integration needs
- [API reference](docs/api.md) — every endpoint and its required permission
