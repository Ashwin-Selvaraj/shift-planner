# Requirements traceability

Every section of the *Shift Planner Application BRD/FRD v2.0*, mapped to where
it is implemented, plus the decisions taken where the document left room for
interpretation.

**Status key** — **Built**: implemented and exercised. **Partial**: implemented
within the web application's scope, with the remainder noted. **Not built**:
deliberately out of scope, with the reason given.

| § | Requirement | Status | Where |
|---|---|---|---|
| 1 | Executive summary | Built | Whole system |
| 2 | Business problem | Built | Addressed by the auto-roster and validation engines |
| 3 | Business objectives | Built | See "Objectives" below |
| 4 | Expected benefits | Built | See "Objectives" below |
| 5 | Scope | Built | Every in-scope item below; out-of-scope items absent by design |
| 6 | User roles and permissions | Built | `apps/api/src/lib/permissions.ts`, enforced by `requirePermission`, mirrored in the UI |
| 7 | Employee master management | Built | `apps/api/src/services/employee-import.ts`, `apps/web/src/pages/Employees.tsx` |
| 8 | Team hierarchy | Built | `Employee.managerId` / `teamLeadId` / `shiftLeadId`; multiple teams, locations and business units |
| 9 | Shift management | Built | `Shift` model, `apps/api/src/routes/config.ts`, Settings screen |
| 10 | Shift capacity planning | Built | `minStaff` / `maxStaff` / `shiftLeadsRequired` / `coreResourcesRequired`; enforced at publication |
| 11 | Dashboard | Built | `apps/api/src/routes/dashboard.ts`, `apps/web/src/pages/Dashboard.tsx` |
| 12 | Monthly roster planning | Built | `apps/web/src/pages/RosterPlanner.tsx` — month/week/day, drag-and-drop, bulk, conflict detection |
| 13 | Core resource management | Built | Pass 2 of the roster engine; `MISSING_CORE_RESOURCE` blocks publication |
| 14 | Shift lead coverage | Built | Pass 1 of the roster engine; `MISSING_SHIFT_LEAD` blocks publication |
| 15 | Shift assignment rules | Built | One shift per day via a unique constraint; leave and holiday handling in both engines |
| 16 | Employee wellness policy | Built | Stability weighting in the roster engine; `EXCESSIVE_SHIFT_ROTATION` |
| 17 | Shift transition rules | Built | `policy.restrictedTransitions`; override required and audited |
| 18 | Rest period compliance | Built | `restHoursBetween()`; `INSUFFICIENT_REST` |
| 19 | Weekly off rules | Built | Demand-aware off placement; `MISSING_WEEKLY_OFF` blocks publication |
| 20 | Consecutive working day rules | Built | Hard cap at 6, streak-fatigue penalty targeting the preferred 5, `SEVEN_DAY_STREAK` |
| 21 | Leave management | Built | `apps/api/src/routes/leaves.ts`; the full emergency workflow |
| 22 | Holiday management | Built | Per-location calendars; all five locations seeded |
| 23 | Holiday compensation | Built | `HolidayCompensation`, unique per employee and date — exactly one choice |
| 24 | Auto-roster engine | Built | `packages/core/src/roster-engine.ts` |
| 25 | Validation engine | Built | `packages/core/src/validation-engine.ts` |
| 26 | Notifications | Partial | In-app built. Email, push and Teams are declared adapters reporting as unconfigured |
| 27 | Reporting and analytics | Built | All five reports, `packages/core/src/reports.ts` |
| 28 | Audit trail | Built | `AuditLog`; user, timestamp, previous value, updated value, reason |
| 29 | Mobile application | Partial | Responsive web covering phones and tablets. Native apps not built |
| 30 | Integration requirements | Not built | Boundaries documented in [integrations.md](integrations.md) |
| 31 | Security requirements | Partial | RBAC, bcrypt, JWT, full audit logging built. SSO/MFA and encryption at rest are deployment concerns |
| 32 | Non-functional requirements | Built | Roster generation well inside 60 s; schema scales to 10,000+; see below |
| 33 | Future enhancements | Not built | Correctly future scope |
| 34 | Success criteria | Built | Measurable through the reports; see below |

---

## Objectives and success criteria (§3, §4, §34)

| KPI (§34) | Target | How the system delivers it |
|---|---|---|
| Manual planning effort | 80% reduction | A 50-person month generates in ~30 ms versus manual preparation |
| Shift lead coverage | 100% | `MISSING_SHIFT_LEAD` is a critical error; publication is blocked |
| Core resource coverage | 100% | `MISSING_CORE_RESOURCE` is a critical error; publication is blocked |
| Wellness compliance | 95%+ | Measured directly by the Wellness report |
| Scheduling conflicts | <1% | Duplicate assignment and leave conflict are both critical |
| Roster publication time | <1 hour | Generation, validation and publication are a single session |
| Planner satisfaction | 90%+ | Not measurable from software; the reports supply the inputs |
| Employee satisfaction | 90%+ | Not measurable from software; the Wellness report supplies the inputs |

The last two are survey outcomes. The system provides the data behind them; it
cannot report on them itself, and does not pretend to.

---

## Non-functional requirements (§32)

| Requirement | Target | Actual |
|---|---|---|
| Roster generation | < 60 seconds | ~3.5 s for 10,000 employees over 31 days; ~30 ms for 50. Covered by a test that fails if the budget is exceeded |
| Scalability | 10,000+ employees | Verified by the same test; the schema is indexed on every query path |
| Availability | 99.5% uptime | Deployment concern. The API is stateless and horizontally scalable; graceful shutdown drains in-flight requests |
| Reliability | Automated backups | Deployment concern; standard for the chosen database |
| Retention | Audit logs for 7 years | `AuditLog` rows are never deleted by the application |

---

## Decisions where the document was open to interpretation

Six places needed a judgement call. Each is recorded here with its reasoning so
it can be revisited as a business decision rather than rediscovered as a bug.

**1. A weekly "off" means any non-working day (§19).**
The document requires a minimum of one weekly off and validation before
publication, without saying whether approved leave counts. Both engines treat
`OFF`, `LEAVE` and `HOLIDAY` as satisfying it. Requiring an additional rostered
off from someone who was on leave all week would make a legal roster
permanently unpublishable. Changing this means changing both engines together —
they disagreed during development, and the disagreement made valid rosters
unpublishable until it was resolved.

**2. Weekly off is a critical error (§19, §25).**
Section 25's list of critical errors does not include it, but section 19 makes
validation mandatory before publication. It blocks publication. Downgrade it in
`CRITICAL_CODES` if the business prefers a warning.

**3. Restricted transitions apply only back-to-back (§17).**
The restricted pairs are S1→S3 and S3→S1. Working S3 on Friday, resting
Saturday and opening S1 on Sunday is not a restricted transition — the rule
exists for circadian disruption between consecutive shifts, and a rest day
clears it. Applying it to the last worked day regardless of gap made the engine
reject legal assignments and strand shifts without a lead.

**4. Rest shortfalls warn, restricted transitions block (§17, §18).**
Section 17 enumerates restricted transitions; section 18 states a general rest
rule and says a violation "generates warning or restriction". The enumerated
list is treated as hard and override-only; the general rest rule (default 11
hours) warns. So S2→S1, which leaves only 8 hours, is flagged without blocking.

**5. Fair distribution is measured within a peer group (§25).**
Shift leads and core resources carry mandatory per-shift coverage and
legitimately work more days than general staff. Comparing everyone against one
team-wide mean reported that structural difference as unfairness every month.
Workload is compared within Shift leads, Core resources and Team members
separately, and a deviation must be at least two days as well as beyond the
tolerance before it is reported.

**6. Team Lead "Planning Support" is read access (§6).**
The document grants a team lead Team Schedule View, Planning Support and
Reports, and explicitly bars uploading employees and publishing rosters.
"Planning support" is not defined, so the narrow reading applies: read access to
the team roster plus the ability to raise leave requests. Widening it is one
line in `apps/api/src/lib/permissions.ts`.

---

## Holiday coverage (§15, §23)

Section 15 says "business-defined coverage requirements apply" on holidays
without defining them. The system covers a configurable fraction of normal
minimum staffing — `holidayCoverageRatio`, default 0.5 — and validates holidays
against that reduced minimum rather than the full one. Employees who work a
holiday can then claim comp-off or double pay under section 23.
