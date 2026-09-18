# Keep bounded runtime orphan cleanup ahead of arrivals

Status: active

## Outcome and invariant
Increase service opportunities for the existing bounded runtime resource cleanup so ordinary checkpoint churn cannot indefinitely grow eligible snapshot/replica backlog. Preserve the 65-minute grace, canonical-reference protection, exact upload/drain fences, terminal retirement, revision acknowledgment, per-run bounds, cron authentication, and external work outside transactions.

## Cause and scope
The external retention cron runs hourly. Its runtime cleanup selects at most 50 orphans and uses a 25-second budget. Even an ideal run cannot keep up with a synthetic 200 candidates per hour. This is scheduling capacity, not evidence that a particular protected object may be deleted. Existing account-deletion and expired-computer cleanup share the route; evaluate their due-time/lease/idempotency guards before choosing a cadence change. Prefer the smallest existing-owner correction, with no new route, worker, queue, table, unbounded loop or broad cleanup refactor.

## Proof
Use synthetic arrivals and current checked-in schedule/batch boundaries to show the capacity mismatch. Check the configured schedule and real cron/retention composition, retained cleanup safety tests, affected typecheck, parent privacy and complexity review. ReviewGPT authors the substantive patch. Final ReviewGPT runs on the pushed candidate concurrently with required exact-head CI.

## Authority and compatibility
Functional scheduling change: prepare a reviewed PR for human merge only. No production deletion, recovery, cron invocation, configuration update, merge or deployment. Existing durable cleanup contracts and Web/Worker protocol remain unchanged.

## Progress
- Broad production sweep and read-only eligibility joins establish persistent backlog and the hourly 50-candidate ceiling.
- Related open PR diffs and relevant worktree branch diffs concern other retention owners; no concrete collision found.
- A previously requested Linq telemetry proposal is deferred without applying its source patch. This is the sole implementation selected for this run.
- ReviewGPT returned a verified GPT-6 Pro patch: only the existing cron expression changes in production, with schedule, composition and actual PostgreSQL cleanup proof. Parent inspected its guards and bounded cost.
- Baseline: 324 tests passed, including 53 real PostgreSQL cases on an isolated migrated loopback test database; Web typecheck passed.
- New capacity regression failed on the old hourly expression, then passed with the five-minute schedule. The real cleanup owner clears the 200 synthetic eligible records across configured invocations while retaining its 50-row batch ceiling.
- Changed candidate: 271 cron/guard/account/computer cases plus 54 real PostgreSQL cases passed (325 total). Web typecheck, docs drift, complexity guard and whitespace checks passed. Parent privacy and full-diff review passed.
- Final pushed-candidate ReviewGPT and exact-head CI remain pending; human merge only.
- Internal resource housekeeping; no assistant journey, member-facing UI change or public changelog item.
