# Host Runtime Fence Recovery

## Goal

Fix the remaining hosted runtime deadline-removal review findings without
reintroducing a broad host deadline.

Success means:

- deploy-smoke fences are not handled by normal runtime wake/replacement logic
- runtime workspace wakes probe active-owner liveness instead of deferring blindly
- unconfirmed stale runtime owners use one explicit replacement path
- legacy `active_expires_at` values are inert and never clear active fences
- removed `deadlineAt` payload fields reject at parser boundaries
- runtime wake callbacks are not accepted after a runtime result has been produced

## Constraints

- Preserve Cloudflare as execution adapter only; web/Temporal own demand.
- Do not add a new scheduler, environment variable, generic watchdog, or host
  runtime duration cap.
- Keep recovery local to existing write-fence ownership and container liveness
  checks.

## Plan

1. Tighten runtime write-fence handling by kind.
2. Make workspace wake use the same active-owner probe path as other runtime
   demand.
3. Escalate stale runtime owner probes through the existing replacement path.
4. Stop copying or acting on legacy active-fence expiry timestamps.
5. Add removed-field parser guards for `deadlineAt`.
6. Clear/refuse runtime wake callbacks after runtime result production.
7. Add focused regression tests and run the Cloudflare/parser verification lane.

## Verification

- Focused Cloudflare runner tests for deploy-smoke, workspace-wake, unconfirmed
  wake recovery, inert legacy expiry timestamps, and late wake acceptance.
- Parser tests for removed `deadlineAt` fields.
- `pnpm test:diff` or the relevant app/package verify lane, plus typecheck.
Status: completed
Updated: 2026-06-05
Completed: 2026-06-05
