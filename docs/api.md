# API reference

Base URL `/api`. Every endpoint except `POST /auth/login` and `GET /health`
requires `Authorization: Bearer <token>`.

The **Permission** column is the capability from the BRD 6 role matrix
(`apps/api/src/lib/permissions.ts`). A role without it receives `403`.

## Responses

| Code | Meaning |
|---|---|
| `400` | Malformed request. Zod issues are returned per field. |
| `401` | Missing, invalid or expired token. |
| `403` | Authenticated, but the role lacks the permission. |
| `404` | Not found. |
| `409` | Conflict — a duplicate, or a rule that forbids the transition (for example publishing a roster with critical errors). |
| `422` | Upload rejected. Carries the per-row error report. |

Errors are `{ "error": string, "details"?: unknown }`.

---

## Auth

| Method | Path | Permission | Notes |
|---|---|---|---|
| `POST` | `/auth/login` | — | `{ email, password }` → token and user with permissions |
| `GET` | `/auth/me` | authenticated | Current user and permissions |

## Employees (BRD 7)

| Method | Path | Permission | Notes |
|---|---|---|---|
| `GET` | `/employees` | `employee:read` | Filters: `teamId`, `locationId`, `role`, `status`, `search` |
| `GET` | `/employees/:id` | `employee:read` | Includes team, location and reporting lines |
| `POST` | `/employees` | `employee:write` | |
| `PATCH` | `/employees/:id` | `employee:write` | Accepts a `reason` for the audit trail |
| `DELETE` | `/employees/:id` | `employee:write` | Deactivates; never deletes |
| `GET` | `/employees/template` | `employee:upload` | XLSX template with an instructions sheet |
| `POST` | `/employees/upload` | `employee:upload` | Multipart `file`. `?dryRun=true` validates without writing |
| `POST` | `/employees/:id/account` | `employee:write` | Issues a login |

The upload is all-or-nothing. If any row fails, the response is `422` with every
problem listed by row and field, and nothing is written.

## Configuration (BRD 8, 9, 10, 16–20)

| Method | Path | Permission |
|---|---|---|
| `GET` | `/config/teams` | `team:read` |
| `POST` | `/config/teams` | `team:write` |
| `PATCH` | `/config/teams/:id` | `team:write` |
| `GET` | `/config/locations` | `holiday:read` or `team:read` |
| `POST` | `/config/locations` | `location:write` |
| `GET` | `/config/shifts` | `shift:read` |
| `POST` | `/config/shifts` | `shift:write` |
| `PATCH` | `/config/shifts/:id` | `shift:write` |
| `GET` | `/config/policy` | `shift:read` |
| `PUT` | `/config/policy` | `settings:write` |

Shift times accept `06:00` or `06:00 AM`. A shift whose end is at or before its
start crosses midnight.

## Rosters (BRD 12, 24, 25)

| Method | Path | Permission | Notes |
|---|---|---|---|
| `GET` | `/rosters` | `roster:read` | Team members see only their own team |
| `GET` | `/rosters/:id` | `roster:read` | Team members see only their own assignments |
| `POST` | `/rosters/generate` | `roster:generate` | `{ teamId, year, month, preserveLocked?, overwrite? }` |
| `PUT` | `/rosters/:id/assignments` | `roster:write` | One cell. Re-validates immediately |
| `POST` | `/rosters/:id/assignments/bulk` | `roster:write` | `{ employeeIds[], dates[], type, shiftId? }` |
| `POST` | `/rosters/:id/validate` | `roster:read` | Runs the validation engine |
| `POST` | `/rosters/:id/approve` | `roster:approve` | `409` if critical errors remain |
| `POST` | `/rosters/:id/publish` | `roster:publish` | Re-validates; `409` lists the blocking issues |
| `POST` | `/rosters/:id/withdraw` | `roster:publish` | Requires a `reason` |

Generation refuses to overwrite a published roster. An existing draft needs
`overwrite: true`. Manual edits are locked and survive regeneration unless
`preserveLocked: false`.

Setting an assignment that creates a restricted transition requires
`overrideReason`; without it, validation reports `RESTRICTED_TRANSITION` and
publication is blocked.

## Leave (BRD 21)

| Method | Path | Permission | Notes |
|---|---|---|---|
| `GET` | `/leaves` | `leave:read` or `leave:request` | Team members see only their own |
| `POST` | `/leaves` | `leave:request` | Rejects overlapping requests |
| `GET` | `/leaves/:id/replacements` | `leave:approve` or `roster:write` | Ranked stand-ins per affected day, with reasons |
| `POST` | `/leaves/:id/decision` | `leave:approve` | `{ decision, reason?, replacementId? }` |

Approving rewrites the affected assignments so the roster and the leave calendar
cannot disagree, and returns any shifts left uncovered.

## Holidays (BRD 22, 23)

| Method | Path | Permission |
|---|---|---|
| `GET` | `/holidays` | `holiday:read` |
| `POST` | `/holidays` | `holiday:write` |
| `DELETE` | `/holidays/:id` | `holiday:write` |
| `GET` | `/holidays/compensation` | `leave:read` or `report:read` |
| `POST` | `/holidays/compensation` | `leave:request` |

Compensation is `COMP_OFF` or `DOUBLE_PAY`, exactly one per employee per date,
and only for a holiday the employee actually worked.

## Reports (BRD 27)

| Method | Path | Permission |
|---|---|---|
| `GET` | `/reports/coverage/:rosterId` | `report:read` |
| `GET` | `/reports/utilization/:rosterId` | `report:read` |
| `GET` | `/reports/wellness/:rosterId` | `report:read` |
| `GET` | `/reports/distribution/:rosterId` | `report:read` |
| `GET` | `/reports/compliance/:rosterId` | `report:read` |

## Dashboard, notifications and audit (BRD 11, 26, 28)

| Method | Path | Permission | Notes |
|---|---|---|---|
| `GET` | `/dashboard` | `dashboard:read` | Optional `teamId`. `hasRosterForToday` distinguishes "nothing planned" from "zero coverage" |
| `GET` | `/notifications` | `notification:read` | Includes which channels are configured |
| `POST` | `/notifications/:id/read` | `notification:read` | |
| `POST` | `/notifications/read-all` | `notification:read` | |
| `GET` | `/audit` | `audit:read` | Filters: `entity`, `entityId`, `action`, `userId`, `from`, `to`, `page`, `pageSize` |
| `GET` | `/health` | — | Liveness probe |

## Validation codes

Returned in `validation.issues[].code`.

**Critical — publication blocked:** `MISSING_SHIFT_LEAD`,
`MISSING_CORE_RESOURCE`, `LEAVE_CONFLICT`, `DUPLICATE_SHIFT_ASSIGNMENT`,
`SEVEN_DAY_STREAK`, `CAPACITY_BELOW_MINIMUM`, `CAPACITY_ABOVE_MAXIMUM`,
`MISSING_WEEKLY_OFF`, `RESTRICTED_TRANSITION`, `INACTIVE_EMPLOYEE_ASSIGNED`.

**Warning — publication allowed:** `UNEVEN_DISTRIBUTION`,
`EXCESSIVE_SHIFT_ROTATION`, `SIX_DAY_CONSECUTIVE`, `INSUFFICIENT_REST`,
`OVERRIDDEN_TRANSITION`.
