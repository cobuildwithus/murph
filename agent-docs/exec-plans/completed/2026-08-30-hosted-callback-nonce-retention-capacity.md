# Split hosted retention owners and restore callback nonce capacity

## Outcome

Replace the catch-all hourly hosted retention invocation with four staggered,
Web-owned Vercel cron jobs separated by failure domain. Give callback nonce
retention its own 100× catch-up ceiling so it can drain the production backlog
without depending on ordinary database cleanup, external browser providers,
runtime signals, or the diagnostic-log database.

## Invariants

- Callback replay admission remains one atomic primary-key insert and never
  performs expiry cleanup.
- Cleanup deletes only strictly expired rows in deterministic expiry/hash
  order.
- Each database statement remains capped at 5,000 rows and cleanup remains
  serial.
- Unrelated retention categories keep their existing four-batch ceiling.
- No production entrypoint aggregates all retention owners.
- Ordinary primary-database retention, nonce retention, external provider
  cleanup, and runtime/log maintenance have distinct authenticated routes and
  staggered hourly schedules.
- Only the nonce route receives the explicit 800-second catch-up duration;
  every other retention route remains capped at 300 seconds.
- An account-deletion or computer/browser provider failure cannot delay or
  prevent callback nonce cleanup.
- The small browser-assertion nonce lane runs before callback catch-up, and
  runtime-signal fan-out runs before optional runtime-log cleanup, so the
  extended or best-effort work cannot starve the shorter owner in either shared
  domain.
- Account deletion keeps its independent member-scoped nonce deletion.

## Evidence

- Read-only production aggregates showed that the callback nonce table owns
  essentially all current database storage and that almost every retained row
  is expired.
- Current hourly nonce creation materially exceeds the shared four-batch,
  20,000-row cleanup ceiling.
- Current code and tests confirm the hourly owner, 5,000-row `SKIP LOCKED`
  statements, and shared four-batch cap.

## Scope

- Hosted retention owner modules and the four internal cron routes
- `apps/web/vercel.json` and the approved-route guard
- Focused owner, orchestration, route, and opt-in PostgreSQL capacity tests
- Current architecture/operator documentation for hosted retention

No schema, callback authentication, Cloudflare, Temporal, or foreground request
path changes are in scope.

## Implementation

1. Add a nonce-specific max-batch ceiling derived as 100× the shared ceiling.
2. Remove the aggregate cleanup runner and route each failure domain through a
   dedicated owner: control-plane, nonces, external providers, and runtime/logs.
3. Register the four routes at 5, 20, 35, and 50 minutes past each hour so their
   normal execution windows do not pile onto the same database minute.
4. Give only the nonce route an 800-second duration; cap the other routes at
   300 seconds.
5. Prove route isolation when external computer cleanup fails and add an
   opt-in real-PostgreSQL scenario for sustained full nonce batches plus fresh
   inserts.
6. Align durable architecture, runtime-log, testing, and Web operator docs.

## Verification

- Focused hosted retention owner, route, and Vercel configuration Vitest suite.
- Opt-in local PostgreSQL capacity/concurrency proof.
- Web package typecheck and any build required by the public-entrypoint rules.
- Parent diff review plus the required final ReviewGPT remediation round,
  concurrent with exact-head CI.

Completed evidence: 89 focused Vitest cases passed; four opt-in PostgreSQL
concurrency/capacity cases passed against an isolated local database; Web
typecheck, targeted lint, documentation drift, and merge-tree checks passed;
ReviewGPT substantive round 2 returned `ROUND_OUTCOME: PASS` with no findings
and confirmed both prior accepted findings were resolved.

## Deployment and rollback

- Web-only deployment replaces one registered Vercel cron with four; no
  Cloudflare, Temporal, or database migration dependency.
- Monitor each route independently: status/duration for all four, primary-pool
  pressure and lock waits for database owners, provider errors for external
  cleanup, and nonce backlog/storage convergence for the catch-up owner.
- Roll back the Web change if foreground database health regresses; the prior
  single route remains schema-compatible but restores the lower nonce ceiling
  and its cross-domain failure coupling.

## Status

- [x] Root cause and owning boundary proved.
- [x] Implement nonce-only capacity increase.
- [x] Split the catch-all owner into four staggered routes.
- [x] Run focused local and PostgreSQL proof.
- [x] Complete the final ReviewGPT and parent-review gates.
- [x] Close the plan and hand the docs-only closure head to exact-head CI.
Status: completed
Updated: 2026-08-30
Completed: 2026-08-30
