# Quiet members sync devices once a day

Status: completed
Created: 2026-11-17
Updated: 2026-11-17

## Goal

Members who have stopped using Murph keep their wearable connected, and every
Junction webhook or 6-hour scheduled reconcile still starts a Cloudflare
container for them. Production measurement (7 days, 2026-11-16): members with
a device connection and no engagement for 60+ days cause roughly a third of
all device-sync container wakes, most of which import nothing. The owner
approved collapsing their device sync to one daily window and syncing again
promptly when they come back.

Outcome: a quiet member's device data still lands every day (no gaps, no
backfill), with about one or two device-sync wakes per connection per day
instead of about six. Everyone else is unchanged.

## Success criteria

- A quiet member's webhook dirty transition defers its wake to the
  connection's next daily window instead of waking now or in 30 minutes.
- A quiet member's due scheduled reconcile outside the window moves
  `next_reconcile_at` to the next window start instead of waking.
- Inside the window, a quiet member behaves exactly as today.
- An inbound Linq message (direct, or the verified sender of a group message)
  or an app foreground heartbeat pulls any quiet deferral more than 30
  minutes out forward to now, so the next 5-minute recovery sweep wakes it.
- Non-quiet members: identical wakes, deadlines and mailbox items as today,
  except the bounded orphan-recovery ownership fix below.
- Production check after deploy: device-sync mailbox wakes for the quiet
  cohort drop by well over half within 48 hours, with daily applied imports
  still present for members whose devices send data.

## Scope

- In scope (Web only, `apps/web`):
  - New module `src/lib/device-sync/quiet-member.ts`: the quiet predicate,
    the daily window, the webhook release time and the reconcile postponement.
  - New leaf module `src/lib/device-sync/quiet-member-return.ts`: the
    pull-forward (and the routine 30-minute constant it compares against), so
    Linq daily state can import it without an import cycle.
  - `wake-service.ts` `settleHostedDeviceSyncWebhookWakeDeferralTx`: quiet
    branch.
  - `due-reconcile-sweeper.ts`: quiet postponement before preflight.
  - `prisma-store/connections.ts` `listDueReconcileConnectionsForSweep`: a
    batch with a live `wake_deferred_until` is owned by the deferred-wake
    sweeper, so it is not orphaned dirt.
  - Pull-forward calls in `hosted-onboarding/linq-daily-state.ts`
    (`incrementHostedLinqInboundDailyState`, the owner of Linq inbound
    accounting), the verified group sender in
    `hosted-onboarding/webhook-provider-linq.ts` (group quota is charged to the
    group, not the sender) and `companion/presence.ts`
    (`recordCompanionHeartbeat`).
- Out of scope: runner/Cloudflare changes, Temporal, schema migrations,
  runtime-scheduled continuation/retry wakes, scheduled assistant jobs (the
  2026-11-16 review advised against a member-wide block), manual reconcile,
  connection-established and Fitbit migration wakes (all stay immediate).

## Design

### Quiet predicate

`readHostedDeviceSyncMemberQuiet({ memberId, now, prisma|tx })` is true when
all hold, cheapest first, short-circuiting:

1. Member row: `created_at` older than 60 days; `companion_last_foreground_at`
   null or older than 60 days; not `hasHostedMemberOwnPaidBilling` (active,
   unsuspended billing with paid evidence: members on a paid plan are never
   quiet; a canceled or past-due former subscriber can be).
2. No group participant evidence in 60 days
   (`hosted_thread_container_participant.last_seen_at`, not removed). Rosters
   also renew it, so everyone in a recently active group, including silent
   group game players whose data others see, keeps the normal cadence.
3. No Linq inbound in 60 days: existing
   `hasHostedLinqInboundWithinDays({ windowDays: 60 })`.
4. No mailbox engagement in 60 days: existing
   `hasHostedMailboxAutomationEngagementSince` (meal photo, Telegram, email).

Reads 1, 3 and 4 are indexed point/range reads. Read 2 has no
participant-first index; the table has 120 rows (2026-11-17), so it is a
trivial scan. The predicate is evaluated only
on paths that would otherwise wake: a webhook that requests or claims a wake,
and a due scheduled reconcile. No new table, column, flag or state owner.

### Daily window

`resolveHostedDeviceSyncQuietWindow({ connectedAt, now })` returns
`{ inside: boolean; nextStart: Date }`. Each connection's window is one hour
starting at its `connected_at` UTC time of day, which spreads quiet
connections across the day with no stored state. The window is one hour
because the recovery sweep runs every 5 minutes; a deadline at the window
start is always serviced inside the window.

### Webhook path (`settleHostedDeviceSyncWebhookWakeDeferralTx`)

Current rules: a dirty transition (`shouldRequestWake`) of a routine Junction
daily total defers 30 minutes; any other transition wakes now; a non-routine
event on an already-dirty connection claims a pending deferral and wakes now.

New rule, applied only when the event would wake or claim and the member is
quiet and the connection is outside its window:

- `shouldRequestWake` true: `deferDirtyConnectionWakeTx` until 10 minutes
  after the window's `nextStart`; return false. Any device-sync wake for a
  connection fetches and applies that connection's pending dirty state in the
  runtime (`applyHostedPendingDirtyDeviceSyncState`), so the window's
  scheduled reconcile normally drains the batch first and the later release
  clears without starting another container.
- non-routine claim case: do not claim; return false. The existing deadline
  stays.

Routine non-transition events already do nothing; unchanged.

### Scheduled reconcile (`runHostedDeviceSyncDueReconcileSweeper`)

Before the preflight probe, for a due connection without
`orphanedDirtyRecoveryKey`, outside its window, whose observed
`next_reconcile_at` is after the last window start (a schedule the last window
never serviced, e.g. after an outage, catches up instead of waiting another
day), and whose member passes an unlocked quiet check: take the existing
`withHealthDataAdmissionLock` (member row, then the connection advisory lock
runtime apply uses), re-read the connection, and postpone only when it is
still active, in an ordinary setup phase (`null` or `source_confirmed`, as in
preflight), unchanged since the sweep observed it, has no Junction history
retry pending (`readJunctionHistoricalBackfillProgress(...).status ===
"retrying"`, which owns a short `next_reconcile_at`), and the member is still
quiet. The write is guarded on id, user, status, `connected_at`, `updated_at`
and `next_reconcile_at`, like preflight's, and moves `next_reconcile_at` to
the next window start. Count it in the sweep log as `quietPostponed`. The provider still sets the next cadence
after the window's reconcile; that next due lands outside the window and is
postponed again, so a quiet connection reconciles once a day.

### Orphaned dirt

`listDueReconcileConnectionsForSweep` flags dirt with no mailbox work owner as
orphaned and wakes it. A live `wake_deferred_until` is a durable owner (the
deferred-wake sweeper releases it, and postpones on release failure), so add
`dirty.wake_deferred_until is null` to the orphan predicate. Without it, a
quiet deferral would be woken by the first due reconcile. This is the one
bounded change for non-quiet members: a routine 30-minute batch whose
reconcile comes due is no longer woken early as orphaned dirt; its own
deadline releases it within 30 minutes.

### Coming back

`pullForwardHostedDeviceSyncQuietDeferrals({ userId, now, prisma|tx })`:
`UPDATE device_sync_dirty_connection SET wake_deferred_until = now WHERE
user_id = $1 AND wake_deferred_until > now + 30 minutes`. Only quiet-length
deadlines move; routine 30-minute batches keep their timing. Called in
`incrementHostedLinqInboundDailyState`, for the verified group sender, and in
`recordCompanionHeartbeat` on foreground, each inside the caller's existing
transaction and member lock. The next recovery sweep (every 5
minutes) releases the batch through the existing release path. The member is
no longer quiet from that moment, so every later webhook and reconcile follows
today's rules. A postponed `next_reconcile_at` keeps its date (at most 24 h);
the scheduled reconcile is the missed-webhook safety net, not the freshness
path.

Known limits:

- The first reply to a returning member can run before the pulled-forward
  sync lands (up to about 5 minutes plus the pass). Their later replies see
  fresh data.
- A quiet deadline already within 30 minutes is not pulled forward (it cannot
  be told apart from a routine batch without new state), so the return bound
  is up to about 30 minutes plus the pass.
- Telegram and email count as activity for future decisions but do not pull
  an existing deferral forward; it lands at the next window. Three members
  used those channels in the last 60 days (2026-11-17).

## Constraints

- Web-only deploy; no runner, Temporal or wire change, so no deploy skew.
  During a mixed Web rollout old instances may wake quiet members early or
  treat a held batch as orphaned; that only reduces savings briefly.
  Rollback = revert. Reverting does not undo stored future
  `wake_deferred_until` or postponed `next_reconcile_at` values; today's
  sweeps service them at those times (at most about a day).
- Minimal moving parts: reuse the existing deferral column and sweeper, the
  existing engagement and paid-billing predicates, no new config.
- Database: the predicate adds at most three indexed reads inside the existing
  webhook transaction, only on wake-producing events. The pull-forward is one
  indexed UPDATE (`device_sync_dirty_connection (user_id, provider)` index).

## Risks and mitigations

1. Risk: a quiet member's urgent data (sleep, workouts) waits up to a day.
   Mitigation: intended for members with no message, app open or payment in
   60 days; it lands within the day and immediately on return.
2. Risk: the quiet read slows the webhook transaction.
   Mitigation: evaluated only when a wake would be produced; three indexed
   reads; measure with the existing webhook trace timing after deploy.
3. Risk: the orphan predicate change hides real orphaned dirt.
   Mitigation: only rows with a deadline are excluded; the deferred sweeper
   owns them and retries every 5 minutes on failure; a cleared deadline
   restores orphan detection.
4. Risk: pull-forward on every heartbeat adds DB load.
   Mitigation: one indexed UPDATE that matches no rows for active members.

## Tasks

1. `quiet-member.ts`: predicate, window, pull-forward, with unit tests.
2. Webhook settle quiet branch; tests for transition, claim, inside-window and
   non-quiet unchanged.
3. Due sweeper postponement + `quietPostponed` count; tests.
4. Orphan predicate: exclude live deferrals; test.
5. Pull-forward calls in Linq inbound and companion heartbeat; tests.
6. Typecheck + focused tests; PR; ReviewGPT final round; merge; verify in
   production with the cohort wake query.

## ReviewGPT plan review (2026-11-17)

Lanes `vonneumann` (Free plan on the Chat surface check) and `apollo`
(browser would not start) failed, so the review ran on `mountain`; its
response was recovered by thread export (known frog
`20261111000251-reviewgpt-accepted-sends`). Response:
`audit-packages/plan-quiet-member-daily-device-sync.md`.

1. Use the current-paid predicate (`hasHostedMemberOwnPaidBilling`), since
   retained Stripe references would keep canceled former subscribers
   ineligible. Accepted and built; the unit test covers canceled with a
   retained reference (quiet) and active with the same reference (not quiet).
2. `next_reconcile_at` also owns Junction connect-history retries, and a
   missed window should catch up. Accepted: postponement skips a `retrying`
   history status and non-ordinary setup phases, and does not postpone a
   schedule due at or before the last window start. Source recovery and
   extended backfill jobs ride the ordinary cadence (they do not set
   `next_reconcile_at`), so for quiet members they move to the daily window
   as intended.
3. A standalone compare-and-set can race the runtime apply. Accepted:
   re-read and write under `withHealthDataAdmissionLock` with the
   `updated_at` guard, as preflight does; the unlocked quiet check runs first
   so active members take no lock. Postgres test covers the real lock, write
   and stale-observation no-op.
4. The 30-minute threshold cannot identify every quiet deadline. Accepted
   the smallest option: keep the threshold and document the bound of up to
   about 30 minutes (Known limits).
5. Group activity belongs to the group container. Accepted: participant
   evidence counts as activity, and the verified group sender's deadlines are
   pulled forward. Telegram and email return is documented, not built (three
   members in 60 days).
- Move the pull-forward into the dirty-connection store: rejected. The leaf
  `quiet-member-return.ts` already breaks the import cycle, and the callers
  hold a transaction client, not a store.
- Orphan predicate: confirmed correct (in the CASE, not the WHERE); the
  bounded non-quiet change is now documented above.
- Two-owner integration (scheduled ack before +10 minutes suppresses the
  release; failure keeps it): existing coverage in
  `device-sync-scheduled-wake-retention-postgres.test.ts` (acknowledgment
  clears `wake_deferred_until`; release failure postpones 5 minutes).

## Decisions

- Slow, not pause: the owner approved one daily sync over a full pause so
  quiet members' data has no gaps and needs no backfill.
- 60 days; any of Linq inbound, group participation, mailbox engagement or
  app foreground counts as activity; members on an active paid plan are
  excluded.

## Verification

- Commands to run: focused Vitest for the touched device-sync, companion,
  Linq daily-state and thread-route tests; the opt-in Postgres suite
  `device-sync-scheduled-wake-retention-postgres.test.ts`; `apps/web`
  typecheck.
- Expected outcomes: new tests prove each rule; existing device-sync wake
  tests pass unchanged for non-quiet members.
Completed: 2026-11-17
