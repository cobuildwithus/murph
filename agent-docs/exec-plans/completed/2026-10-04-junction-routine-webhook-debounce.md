# Defer routine Junction webhook wakes

Status: completed
Created: 2026-10-04
Updated: 2026-10-04

## Goal

- Cut background container starts caused by routine Junction daily-total
  webhooks. Aggregate production observation (2026-09-30 to 2026-10-03): about
  94% of Junction webhook hints are routine daily totals (activity summary,
  heart rate, steps, distance, calories, respiratory rate, stress, HRV, floors,
  blood oxygen, VO2 max); sleep, sleep cycle, workouts and workout streams are
  the rest. Each clean-to-dirty transition currently appends an immediate wake,
  and every background wake starts a fresh runner container.
- Routine daily totals reach the runner within a fifteen-minute ceiling instead
  of immediately; everything else keeps today's immediate path.

## Success criteria

- A routine Junction hint that makes a connection dirty records a deferred wake
  deadline (receipt time plus fifteen minutes) and appends no mailbox wake.
- Unknown, non-routine or non-Junction hints keep the existing immediate wake.
- A non-routine hint for an already-deferred connection makes the deadline due
  now, so the next recovery sweep releases it.
- The existing sixty-second recovery sweep appends the ordinary dirty-transition
  wake for due, still-dirty, still-active, consented connections and clears the
  deadline in the same transaction; already-processed rows are only cleared.
- Foreground or maintenance processing may still drain deferred dirty state
  early; nothing is discarded.

## Scope

- In scope: Web webhook admission, the dirty-connection row, the existing
  device-sync recovery sweep and its response summary, a Prisma migration.
- Out of scope: Temporal schedule or activity changes (the activity ignores
  unknown response fields), runner/runtime behavior, non-Junction providers,
  changing which resources are imported.

## Constraints

- Technical constraints: the dirty row and mailbox remain the only owners;
  deferral is one nullable timestamp on `device_sync_dirty_connection`. No new
  queue, cron, service or Temporal signal kind. The admission transaction gains
  no external work; release reuses the scheduled-reconcile append pattern
  (prepared mailbox crypto outside, short database-only transaction inside,
  Temporal signal after commit).
- Product/process constraints: user-approved freshness decision (2026-10-04):
  routine daily totals may wait up to fifteen minutes; sleep and workouts stay
  immediate. Unknown event types are treated as urgent.

## Risks and mitigations

1. Risk: a deferred wake is never released.
   Mitigation: the existing sweep runs every minute; release is idempotent by
   the dirty-revision event id; scheduled reconcile and orphaned-dirty recovery
   remain independent backstops.
2. Risk: a stale deadline from an earlier, already-processed episode releases a
   redundant wake.
   Mitigation: immediate wakes clear the deadline; release requires
   `dirty_revision > processed_revision`; clean rows are only cleared.
3. Risk: consent withdrawal or disconnect during the deferral window.
   Mitigation: release re-checks consent, active status and connection identity
   under the existing health-data admission lock.

## Tasks

1. Schema + migration for `wake_deferred_until`.
2. Routine Junction event classification (explicit allowlist).
3. Admission: defer routine transitions; advance pending deferral on urgent
   hints; clear deadline when an immediate wake is appended.
4. Release sweep and recovery-sweep summary.
5. Focused tests (mocked admission + store, Postgres release where available),
   docs, typecheck, complexity guard, independent review.

## Decisions

- Allowlist the routine daily-total resources; glucose, body, weight, profile,
  historical and connection events stay immediate.
- Anchor the deadline to Web receipt time (`acceptedAt`), not provider
  occurrence time.
- Urgent hints during a deferral advance the deadline instead of appending in
  admission, keeping admission's prepared-crypto plan unchanged.

- Deadline writes use raw SQL; full acknowledgement and credential supersede
  clear the deadline through their existing row rewrite.
- Mailbox crypto preparation stays unchanged for routine hints: gating it would
  break the Fitbit migration successor path, and the saving is negligible.
- The Temporal reconciler interval (60 s default, no production override) bounds
  release precision; no Temporal or activity change is needed because the
  activity parser ignores the added `deferredWakeSweeper` summary.

## Verification

- Mocked admission and release (`apps/web/test/device-sync-hosted-wake.test.ts`):
  routine transition defers to receipt + 15 min with no wake or signal; urgent
  sleep/workout transitions keep the immediate wake; urgent hints on a dirty row
  advance the deadline; routine hints on a dirty row change nothing; release
  appends the deterministic dirty wake, clears in-transaction and signals;
  processed, disconnected, consent-withdrawn and locked-superseded batches only
  clear. Classifier allowlist table included.
- Sweeper and recovery command: `hosted-device-sync-deferred-wake-sweeper.test.ts`
  and `hosted-device-sync-recovery-sweeper.test.ts` (ordering, limits, failure
  isolation, retryable command failure after the other sweeps).
- Store: `prisma-store-dirty-connections.test.ts` (supersede and full-ack clear).
- PostgreSQL (fresh local database migrated from all migrations, including the
  new one; schema diff shows no drift for the new column or index):
  `device-sync-scheduled-wake-retention-postgres.test.ts` adds an end-to-end
  defer, advance, sweep release with real mailbox append and local crypto,
  exactly-once, and full-ack clear case; contention, prepared authority and
  database-spike admission suites still pass (72 PostgreSQL tests).
- `pnpm --dir apps/web typecheck`, `pnpm complexity:diff` (wake-service debt
  unchanged), `scripts/check-agent-docs-drift.sh`.
- Changelog: internal-only; routine wearable totals may arrive up to fifteen
  minutes later and no member-visible feature changes.
- Independent review (Codex, read-only) found one race: an unlocked
  `deadline <= now` cleanup could erase a newer batch admitted with an already
  due deadline after a full acknowledgement. Every clear now also requires the
  exact observed dirty revision, a null read writes nothing, and the rolled-back
  recheck uses the revision it saw under the lock. Mocked and PostgreSQL
  regressions cover it.
- Follow-up review found a second interleaving: a stale release whose observed
  revision was processed meanwhile could clear a newer batch's deadline while
  appending an already-consumed wake. The locked recheck now leaves a newer
  batch untouched for the next sweep; concurrent hint bumps on the observed,
  unprocessed batch still release. A final review found no blocking defects.
- A failed release postpones its due deadline by five minutes so a persistent
  failure cannot occupy the oldest sweep slots ahead of other batches.
  Recovery-sweep tests unrelated to deferral inject an empty deferred store so
  shared-database leftovers cannot affect them.
Completed: 2026-10-04
