# Recurring Runtime Progress Alerts

## Goal

Make an ongoing hosted runtime progress incident email the operations mailbox
again when durable mailbox work remains stuck, without adding a new scheduler,
queue, database schema, or per-member alert owner.

## Evidence

- The existing five-minute runtime-progress monitor already detects live system
  and conversation mailbox work that remains beyond the durable handled
  high-water for at least 15 minutes.
- Its singleton incident currently sends once and stays active until every
  alertable runtime recovers, so one long-running aggregate incident can
  suppress later stalls indefinitely.
- The existing monitor already owns bounded scanning, active-runtime and
  usage-block exclusions, quiet hours, Resend transport, compare-and-swap
  claims, send leases, retry pacing, and aggregate-only evidence.
- ReviewGPT recommended bounded reminders on that existing incident rather than
  a second device-sync correlation monitor.

## Constraints

- Preserve the current 15-minute stall predicate, bounded database scan, active
  runtime access check, usage-block exclusion, and silent recovery behavior.
- Keep email and persisted alert evidence aggregate-only. Do not include member,
  runtime, mailbox item, connection, provider, message, or health-data values.
- Reuse the singleton incident row and five-minute cron. Add no scheduler,
  queue, migration, table, or per-runtime state.
- Keep initial and retried Resend effects idempotent, and give each reminder a
  stable generation key that survives ambiguous provider outcomes.
- Leave latency alerts at one email per continuous incident.

## Product UX Plan

Classification: Product change. The existing operator alert changes from one
email per continuous incident to bounded reminders while the same incident
remains unresolved.

### Outcome

The operations recipient regains timely awareness of an ongoing runtime stall
through fresh aggregate evidence without receiving member-identifying details
or noisy recovery messages.

### Entry And Promise

The existing five-minute monitor opens an alert after the current 15-minute
stall boundary. While the incident remains anomalous, it may send another
aggregate reminder after six hours plus stable jitter, outside the existing
quiet-hours window. Recovery silently rearms the next incident.

### Affected People

- An operator during a long-running aggregate incident receives a clearly
  labeled reminder with current counts and age, not stale first-alert evidence.
- An operator during quiet hours receives no email until the existing morning
  admission boundary permits the next attempt.
- An operator after recovery receives no extra message; a later recurrence is
  a new incident with a new initial-alert identity.
- Members receive no new message or disclosure, and no member, runtime,
  connection, provider, mailbox, message, or health-data value enters the
  alert.

Challenge: recurring mail can become noise during a persistent broad outage.
The six-hour cadence, quiet hours, aggregate-only body, stable per-generation
idempotency, and silent recovery keep the signal bounded while preventing
week-long suppression.

### Proof

Focused monitor tests must prove initial alert, short-window coalescing, fresh
six-hour reminder evidence, quiet-hour deferral, exact retry identity, privacy,
silent recovery, and unchanged latency-monitor cadence.

### Done When

An unresolved progress incident cannot suppress email indefinitely; no
duplicate provider effect is admitted for one reminder generation; and every
body and persisted detail remains aggregate-only.

## Plan

1. Add an optional reminder policy to the shared operational email incident
   owner, retaining the existing compare-and-swap, lease, quiet-hours, and retry
   paths.
2. Opt only the runtime-progress monitor into six-hour reminders with stable
   jitter and fresh aggregate evidence immediately before provider admission.
3. Add focused coverage for reminder eligibility, fresh evidence, stable retry
   identity, concurrency/quiet-hour behavior, privacy, recovery, and unchanged
   latency semantics.
4. Update the runtime alert, reliability, and verification contracts.
5. Run focused tests and typecheck, inspect the final diff, then use the normal
   exact-head ReviewGPT, CI, commit, and PR workflow.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage
  apps/web/test/hosted-runtime-progress-alert-monitor.test.ts
  apps/web/test/hosted-runtime-latency-alert-monitor.test.ts
  apps/web/test/hosted-runtime-latency-alert-cron.test.ts` passes 60 tests.
- `pnpm --dir apps/web typecheck` passes after generating the local Prisma
  client in the isolated worktree.
- Focused ESLint passes for the shared incident owner, progress monitor, and
  progress-monitor test; `git diff --check` passes.
- ReviewGPT recommended the existing aggregate owner plus six-hour reminders,
  no separate device-sync monitor, no recovery email, and no manual reset of an
  already-active production row.
- ReviewGPT's declared patch artifact was not downloadable after two canonical
  recovery attempts. Existing Frog entries already cover the exact missing-tab
  and declared-without-downloadable-artifact failures; the implementation was
  therefore re-derived and verified locally rather than applying an unverified
  artifact.

## Product UX Walkthrough

- Long-running incident: the first alert keeps its existing 15-minute boundary;
  a reminder after six hours plus jitter contains fresh aggregate runtime, lane,
  pending-item, age, and checked-at evidence. Ready.
- Quiet hours: an overdue reminder is deferred and resumes after the existing
  morning jitter boundary without advancing provider-attempt state. Ready.
- Ambiguous Resend outcome: the retry reuses the exact persisted body and
  reminder-generation key. Ready.
- Recovery and recurrence: recovery sends no email and returns the singleton to
  healthy; a later stall receives a new initial incident identity. Ready.
- Member privacy: reminder bodies and persisted evidence exclude private-looking
  runtime keys and carry no member, connection, provider, mailbox, message, or
  health-data values. Ready.

Product purpose verdict: Ready.

## State

Status: active
Updated: 2026-08-18
