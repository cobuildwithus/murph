# Suppress Personal Patterns alerts for usage-limited runs

Status: completed
Created: 2026-09-13

## Outcome and ownership

Operator email stays quiet for explicit provider usage-limit failures and for
occurrences that expire during a recorded platform usage pause, including after
allowance recovery. Other terminal failures and unexplained expirations alert.
The alert classifier currently lacks historical usage evidence; current allowance
state loses that evidence on reset. Keep the history in the existing diagnostic
store, with no billing, scheduling, delivery, schema, or workflow-state change.

## Implementation and constraints

- Record authenticated authoritative reconciliation usage decisions after the
  response, using existing runtime-log storage and retention. Status reads do not
  write; inference overrides count as allowed. Missing evidence preserves alerts.
- Classify each expiration against the last decision at its occurrence and any
  denial before the expiration was observed. Coalesce only unsuppressed alerts.
- Keep the lookup member-scoped and bounded by the 50-entry callback cap; use one
  query outside transactions and outside foreground response latency.
- Additive Web-owned diagnostics require no runner rollout or database migration.
  Older observations are unavailable and are not guessed or backfilled.

## Product UX

Internal operator notification only. Prove usage-limit terminal failure, expiration
following a pause/reset, healthy expiration, unrelated terminal failure in the same
batch, member isolation, missing history, and diagnostic failure. No member-visible
behavior or public changelog change.

## Verification

- Passed 210 focused Web tests across alert classification, authenticated route
  forwarding, authoritative reconciliation, diagnostics, and response timing.
- Passed the real PostgreSQL pause/recovery classifier using the migrated isolated
  log schema, including two members, provider-quota retry, missing history,
  same-time conflicting decisions, and the 50-candidate maximum.
- Passed Web typecheck, changed-source ESLint, complexity diff, and whitespace
  validation. Relevant tests and typecheck were rerun after final source changes.
- Parent review: usage admission, custom inference overrides, billing state,
  scheduling, email body/idempotency, and member delivery remain unchanged.
  New persistence is diagnostic metadata in the existing event format, written
  after the response. Existing reconciliation complexity remains unchanged.
- Internal-only notification behavior: no public changelog or real-Codex journey.
- Delivery scope is a local scoped commit. No PR, CI, ReviewGPT, or production
  deployment has been performed. Those remain PR/release gates if shipping is
  requested; retained history before this instrumentation is not backfilled.
Updated: 2026-09-13
Completed: 2026-09-13
