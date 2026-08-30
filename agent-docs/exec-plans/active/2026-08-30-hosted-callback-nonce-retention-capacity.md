# Restore hosted callback nonce retention capacity

## Outcome

Raise only the hourly hosted callback request-nonce cleanup ceiling by 100× so
the existing Web-owned retention job can drain the production backlog while
preserving small serial `FOR UPDATE SKIP LOCKED` database statements and
foreground callback admission priority.

## Invariants

- Callback replay admission remains one atomic primary-key insert and never
  performs expiry cleanup.
- Cleanup deletes only strictly expired rows in deterministic expiry/hash
  order.
- Each database statement remains capped at 5,000 rows and cleanup remains
  serial.
- Unrelated retention categories keep their existing four-batch ceiling.
- The high-volume catch-up lane runs after the other primary-database retention
  owners, before external runtime-signal fan-out, and has an explicit
  route-duration ceiling.
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

- `apps/web/src/lib/hosted-retention/cleanup.ts`
- `apps/web/test/hosted-retention-cleanup.test.ts`
- Current architecture/operator documentation for callback nonce retention

No schema, callback authentication, Cloudflare, Temporal, or foreground request
path changes are in scope.

## Implementation

1. Add a nonce-specific max-batch ceiling derived as 100× the shared ceiling.
2. Let the existing serial retention helper accept that explicit ceiling only
   for callback nonces.
3. Run nonce catch-up last and give the cron route an explicit bounded duration.
4. Extend focused tests to prove the nonce owner reaches the new ceiling while
   other retention categories remain unchanged.
5. Align durable architecture and operator documentation with the specialized
   bounded budget.

## Verification

- Focused hosted retention cleanup Vitest suite.
- Web package typecheck and any build required by the public-entrypoint rules.
- Parent diff review plus the required exact-head preliminary specialist and
  final ReviewGPT gates, run concurrently with CI.

## Deployment and rollback

- Web-only deployment; no Cloudflare or Temporal compatibility dependency.
- Monitor primary-database pool pressure, lock waits, cron duration, and nonce
  backlog after rollout.
- Roll back the Web change if foreground database health regresses; the prior
  lower cleanup ceiling remains schema-compatible but allows backlog growth.

## Status

- [x] Root cause and owning boundary proved.
- [x] Implement nonce-only capacity increase.
- [ ] Run focused local proof.
- [ ] Complete review gates and exact-head CI.
- [ ] Close the plan and hand off the PR.
