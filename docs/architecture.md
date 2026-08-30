# Architecture

## Shape

Three packages in one npm workspace:

```
@shift-planner/core   Pure domain logic. No database, no HTTP, no framework.
@shift-planner/api    Express + Prisma. Persistence, auth, orchestration.
@shift-planner/web    React + Vite. Presentation.
```

The dependency arrow only ever points inward: `api` and `web` both depend on
`core`, and `core` depends on nothing. That is what makes the scheduling rules
testable without standing up a server, and what lets the client run the same
validation the server runs.

## Data model

```
Location ──< Holiday
    │
    └──< Employee >── Team
             │  │
             │  └──< Leave
             │  └──< HolidayCompensation
             │  └──  User (optional login)
             │
             └──< Assignment >── Shift
                       │
                    Roster >── Team
```

Notes on the choices that are not obvious:

**Shift times are minutes from midnight.** A shift ending at or before the
minute it starts crosses midnight. This makes rest-period arithmetic exact and
timezone-free — `S3` ending 06:00 followed by `S1` starting 06:00 is zero rest,
and the code says so without any date-library ceremony.

**Dates are `YYYY-MM-DD` strings, computed in UTC.** Rosters are planned against
calendar days, not instants. Keeping the whole pipeline off local time removes a
class of off-by-one-day bugs around DST and server timezone drift.

**`Assignment` is unique on (roster, employee, date).** BRD 15 permits exactly
one assignment per person per day; the database enforces it rather than trusting
every code path to remember.

**`User` is separate from `Employee`.** Administrators and managers may exist
without being rostered, and employees exist in the master long before anyone
issues them a login.

**Employees are deactivated, never deleted.** Published rosters and the
seven-year audit trail both reference them.

## Request flow: generating a roster

```
POST /api/rosters/generate
  → requirePermission('roster:generate')       BRD 6
  → load employees, shifts, approved leave,
    holidays, policy, prior month's tail
  → generateRoster()            [core]         BRD 24
      pre-place leave
      pre-place holidays per location
      place weekly offs, demand-aware          BRD 19
      for each day:
        pass 1  shift leads    across all shifts   BRD 14
        pass 2  core resources across all shifts   BRD 13
        pass 3  headcount      across all shifts   BRD 10
      → validateRoster()        [core]         BRD 25
  → persist in one transaction
  → audit                                      BRD 28
```

Validation runs again on every assignment edit, on approval and on publication.
Publication does not trust the cached result: the employee master, the leave
calendar or the capacity plan may have changed since approval.

## The roster engine

A priority-ordered constructive heuristic, not a solver.

**Hard constraints remove candidates.** Approved leave, an existing assignment
that day, a streak already at the cap, a restricted back-to-back transition, or
insufficient rest — any of these and the employee is not a candidate at all.

**Soft objectives rank whoever survives.** Shift stability, fairness against the
running mean, stated preference, and preferred forward rotations, each weighted.

**Three passes per day, across every shift.** Leads first, then core resources,
then general headcount. Filling one shift completely before starting the next
lets an early shift's bulk headcount swallow the only lead a later shift had
left — which surfaces as a publication-blocking gap on a day that had plenty of
people available.

**Weekly offs are placed against live demand.** Each employee takes the
candidate day least loaded with offs *from their own scarcity class* (lead, core
resource, or general), with weekends preferred only as a tiebreak. Rotating offs
arithmetically by index keeps re-colliding whenever the group size and the
number of candidate days share a factor: with five leads and a two-day weekend
pool, every lead lands on the same day off and the shift loses its lead.

**Determinism.** Employees are visited in a stable order and ties break on
employee ID, so the same inputs always produce the same roster. A planner can
regenerate and diff.

**Failure mode.** When the workforce genuinely cannot cover demand, the engine
reports coverage gaps rather than breaking a wellness rule to fill a slot. An
understaffed month produces an honest, unpublishable roster with a precise list
of what is short — never a compliant-looking one that quietly overworks people.

## Performance

Generation is O(days × shifts × employees). For 10,000 employees over 31 days
that is about 2.8 million candidate evaluations, which runs in roughly 3.5
seconds — well inside the document's 60-second budget, and covered by a test
that fails if it regresses.

Indexes cover every query path the API uses: assignments by date, by employee
and date, and by shift and date; employees by team, location, role and status;
leave by employee, status and date range.

## Security

- Passwords are bcrypt-hashed. Sign-in compares against a dummy hash when the
  account does not exist, so timing and message are identical for both failure
  modes and the endpoint cannot enumerate accounts.
- JWT bearer tokens, 8-hour default expiry. Production refuses to start on a
  placeholder or short signing key.
- Every route carries an explicit permission from the BRD 6 matrix.
- A team member's roster query is scoped server-side to their own team and their
  own assignments; the UI restriction is a convenience, not the control.
- Helmet security headers, an explicit CORS allowlist, and a 2 MB JSON body cap.
- Uploads are capped at 8 MB and one file, restricted to `.xlsx` and `.csv`.
- Errors return generic messages in production; details are logged, not
  serialised to the client.

## Deployment

The API is stateless and horizontally scalable; sessions live entirely in the
token. Graceful shutdown drains in-flight requests before disconnecting the
database.

Moving to PostgreSQL means changing `provider` in `prisma/schema.prisma`,
pointing `DATABASE_URL` at the server, and re-running the migration. The schema
uses no SQLite-specific constructs.

The web client calls `/api/*` on its own origin in every environment, so the
same build works behind any reverse proxy without a rebuild.
