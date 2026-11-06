# Recover only aged mailbox handoffs

Status: completed
Created: 2026-10-23

## Outcome and protected invariant

New system mailbox items receive their producer's immediate Temporal signal.
Recovery re-signals only items still unimported after a one-minute grace period;
failed first signals remain recoverable without changing canonical mailbox ownership.

## Evidence and design

`persistHostedDeviceSyncWake` signals inserted wakes after commit, including
scheduled and deferred wakes. The shared handoff query currently includes fresh
unimported rows, duplicating those signals in the same recovery command.
Derive eligibility from existing mailbox creation time, before the query limit.
Capture the recovery command's start time so slow earlier stages cannot age their
own new items into recovery. No new state, flags, queues, caches, or contracts.
The grace period is independent of the Schedule cadence.

## Product UX patch

Outcome: preserve immediate wearable and system work while avoiding redundant wakes.
Reaches: scheduled/deferred device work, preferences, runtime control, and queued
Clinical Records; failed initial signals recover on a later eligible sweep.
Proof: real PostgreSQL age/frontier selection, composed recovery with new wakes,
and existing producer signal and failure tests. No assistant prompt or tools change.

## Failure and rollout

Failed producer signals remain durable and eligible after one minute. Imported,
expired, inactive, and retired work stays excluded. Web-only rollout supports
unchanged old/new Temporal workers and either 60s or 300s schedules. No schema or
wire change; old Web may still duplicate signals during rollout. Parent owns
push, PR, ReviewGPT, CI, merge, and deployment.

## Tasks and verification

1. Add age eligibility and freeze the composed sweep's reference time.
2. Prove all candidate kinds cross the boundary and same-sweep appends do not
   re-signal, including a slow sweep and later recovery after failed signaling.
3. Run focused Web tests, actual PostgreSQL selection, Web typecheck, lint,
   complexity diff, documentation checks, and inspect the final diff.
4. Close this plan, commit scoped files, and write the lane handoff status.

## Changelog

Internal orchestration efficiency only; successful initial signals and user-facing
behavior remain unchanged. No public changelog entry.

## Results and candidate review

Ready at the local implementation boundary. Real PostgreSQL proof passed all
10 cases, including all recovery candidate kinds, the exact one-minute boundary,
Clinical Records current-generation selection, a two-minute composed sweep,
failed handoff retry, and import-frontier exclusion. Producer and sweeper tests
passed 253 cases across five files. Production producer tests prove deferred
releases signal after commit and repeated scheduled appends do not re-signal.

Commands (all exit 0):
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/web test -- hosted-preference-handoff-sweeper.test.ts hosted-device-sync-recovery-sweeper.test.ts hosted-device-sync-deferred-wake-sweeper.test.ts hosted-device-sync-due-reconcile-sweeper.test.ts device-sync-hosted-wake.test.ts`
- `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_dev_sweeper_dup_signal pnpm --dir apps/web exec prisma migrate deploy`
- `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_dev_sweeper_dup_signal MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm --dir apps/web test -- hosted-preference-handoff-sweeper-postgres.test.ts`
- `pnpm --dir apps/web lint` (existing warnings outside changed files)
- `pnpm complexity:diff` (no hotspots; maxima unchanged at 18 and 7)
- `pnpm docs:drift`
- `git diff --check`

Candidate review: one SQL eligibility predicate before LIMIT and one frozen
reference time; no new datastore calls, transactions, external calls, data owner,
wire shape, or foreground-path work. Existing bounds, access revalidation,
expiry, retention, and imported-frontier ownership remain in place. No production
mutation or live delivery claim. Failed initial handoff recovery now waits at
least one minute, then the next eligible sweep plus ordinary backlog/pacing.
No new Frog entry: fresh-checkout dependency installation resolved the missing
Frog executable without a workaround.

External completion remains delegated to the parent: pushed-head CI and
ReviewGPT, merge, deployment, and measurement of actual action savings.
Updated: 2026-10-23
Completed: 2026-10-23
