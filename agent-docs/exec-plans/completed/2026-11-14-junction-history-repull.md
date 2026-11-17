# Junction history re-pull: restore fields the fetch path dropped

Status: completed
Created: 2026-11-14
Updated: 2026-11-14

## Status

Verified so far:

- The coverage generation lever works as described below and is exercised by
  tests; the weight resource generation re-reads nothing, the matrix envelope
  does.
- #4956 (one id per Junction sample and per sleep session) is on `main` and
  this branch is based on it. With it, every timeseries resource gets one
  source identity from the webhook fetch, the reconcile and the backfill
  continuation (82 of 82 cases), so the full backfill a retrying connection
  runs stores nothing under a second id. The settled re-read reads no
  timeseries at all.
- Pacing needs no new machinery: one job per connection on its own six-hour
  reconcile clock, 18 provider reads for a connection up to about 180 days
  old (one inventory, eight summaries over each of two spans, one
  introspection), against 682 for a full backfill.
- Aggregate production counts used for sizing are kept out of this
  repository; they are in the task handoff.

What the diff does: see Design. What is left, in order: push, open the PR,
required CI on the PR head, final ReviewGPT, then the owner's merge and the
runtime deploy on a build that carries #4954 and #4956.

## Goal

- #4954 fixed fetched Junction records losing fields. Recent days repair
  themselves through the 7-day reconcile re-read. This change re-reads the
  older history that nothing else reads again, once per connection, without a
  burst of provider reads, runner wakes or duplicate records.

## What the two named levers do (verified, not read from comments)

1. `JUNCTION_HISTORICAL_BACKFILL_COVERAGE_VERSION`. A connection whose stored
   status carries an older generation has "no recorded outcome", so
   `buildScheduledHistoricalBackfillJobs` queues one connect-window `backfill`
   the next time that connection's scheduled reconcile is created. The same
   function gates the Web reconcile preflight (`history_or_recovery_due`), so
   the preflight cannot skip that wake. As written, the lever falls short in
   three ways:
   - It reads only the connect window, the 180 days before the connection
     date. A source added or reconnected later had its history fetched then,
     after that window. So did any day no webhook delivered.
   - It re-runs the whole backfill. Measured in the provider harness with the
     production resource lists on empty responses (the floor): 62 job claims,
     15 inventory reads, 22 summary reads, 644 timeseries reads and 14
     temporal child jobs. The timeseries reads restore nothing but the four
     opt-in body kinds on the 14 days before the connection.
   - It re-opens the outcome. A settled connection whose re-read finds less
     than before would enter the retry ladder, and an exhausted one would lose
     its reconnect marker and climb the ladder again.
2. The `weight` extended-history generation (`["weight", 2]`). Advancing it
   re-reads nothing. The stored source-by-resource matrix (`m2|…`) holds one
   bit per pair and no generation, and the coverage check compares the
   caller's generation with the current code's, which is always equal. Proven
   by storing a weight bit at generation 2, raising the constant to 3 and
   reading it back as still covered. The generation only fences which
   in-flight job may certify a bit, and names its dedupe key. The lever that
   re-reads is the matrix envelope generation.

## Design

1. Advance `JUNCTION_HISTORICAL_BACKFILL_COVERAGE_VERSION` to 4.
2. A connect window whose stored status is terminal (`complete` or
   `exhausted`) under an older generation is re-read, not re-opened. One local
   decision in the backfill job, with no new job field, queue or metadata key:
   - fetch and import each summary over the connect window, then on to the
     start of the reconcile window in spans no longer than the backfill's own
     (the range every already-proven request uses);
   - queue no timeseries continuation and no temporal-authority children, and
     leave the temporal sweep marker alone;
   - keep the stored outcome: `complete` stays complete, `exhausted` stays
     exhausted unless current evidence proves it complete, and the ladder is
     never restarted;
   - write the status under the current generation at the end. A re-read that
     yields to the foreground writes nothing and is queued again next pass.
   A window with no status, a `retrying` status, a different window, or a
   source-scoped job keeps the ordinary full backfill.
3. Source projection keeps an exhausted window's reconnect markers whatever
   its generation, so the reconcile that runs before the re-read in the same
   pass cannot clear them.
4. Weight: advance the matrix envelope to `m3` and the weight resource
   generation to 3. An `m2` matrix stays a read input with its weight column
   ignored, dropped from each input before the union; every other bit carries
   forward. Writes are always `m3`. The resource generation moves with it so a
   scan that kept its cursor from before #4954 can finish importing but cannot
   certify the re-read; the full scan is queued under its own identity.
5. No pacing machinery. The summary re-read is one job per connection, queued
   by that connection's own six-hour reconcile clock. Weight uses the existing
   one-history-job-per-connection-per-interval selector.
6. Progress is the stored status and matrix per connection; read-only
   aggregate queries are in `packages/device-syncd/README.md`.

## Success criteria

- A connection at `coverage_v3_complete` gets exactly one connect-window
  backfill. It fetches summaries from the connect window to the reconcile
  window and no timeseries, queues nothing, and ends at `coverage_v4_complete`;
  the next schedule queues nothing.
- In a real vault: days imported in the old dropped-field shape, before and
  after the connection date, gain each missing field once through the backfill
  path; workouts are revised in place; nothing is duplicated; a day a webhook
  delivered whole is untouched; a repeat run changes no file.
- An exhausted window keeps its status and reconnect marker through the
  reconcile and the re-read, and becomes complete when the data is there.
- A source whose weight bit sits in an `m2` matrix is scheduled for one weight
  history job; other bits in that matrix stay covered; completion writes `m3`;
  a second schedule queues nothing.
- Weight readings imported by the history job, a webhook fetch and the
  reconcile re-read are one record per reading.
- Every timeseries resource gets one source identity from the webhook fetch,
  the reconcile and the backfill continuation.

## Scope

- In scope: `packages/device-syncd` (coverage generation, the settled re-read,
  the extended-history matrix), its tests and README, the ingestion invariants
  doc, and test literals in the packages that name the generation.
- Out of scope: widening `fat`, `body_mass_index`, `lean_body_mass` and
  `waist_circumference` history (owner decision, below); deleting records
  already stored; anything that runs against production.

## Constraints

- Technical constraints: `device-sync-ingestion-invariants.md`. Pull stays a
  floor; historical completion stays source/resource coverage in the existing
  metadata slots. Web and the runner deploy separately; either may be older.
- Product/process constraints: nothing is merged, deployed or triggered in
  production by this task. It ships after #4954 has run for a day, on a
  runtime that also carries #4956.

## Risks and mitigations

1. Risk: Web on the new generation while the runner is on the old one. Web's
   preflight sees a re-read due and wakes the runner each cadence; the old
   runner sees a current status and does nothing.
   Mitigation: bounded at one wake per connection per six hours, no data
   effect; deploy the runner promptly after merge.
2. Risk: runner rolled back after it wrote `coverage_v4_*` or an `m3` matrix.
   The older runner treats a published `coverage_v4_*` status or `m3` matrix
   as a newer owner's state and stops mutating it, so connect-window retries
   and extended history pause for those connections until it rolls forward.
   Its metadata merge can also drop an `m3` matrix that was not yet published
   to Web; on roll-forward those sources re-read their extended history, which
   is idempotent. Reconcile and webhooks are unaffected either way.
   Mitigation: state the rollback floor; roll forward rather than back.
3. Risk: connections already retrying daily restart their ladder (immediate,
   then 15 minutes, 1 hour, 6 hours, then daily), each a full backfill.
   Mitigation: bounded at three extra runs per such connection; they already
   run the same backfill daily. With #4956 in the runtime that backfill stamps
   the same source identity as the webhook fetch for every timeseries kind.
4. Risk: re-reading sleep before #4956 is in the runtime leaves a stale total
   for any night whose start or end the provider has since rewritten.
   Mitigation: #4956 is merged; this deploys on a runtime that carries it.
5. Risk: a day already whole (delivered by webhook) is fetched again by the
   later-window re-read. No event changes, but the fetched payload is stored
   as raw evidence once.
   Mitigation: one-time and bounded by the days a source has; a repeat stores
   nothing.

## Tasks

1. Real-vault test for the backfill path (old-shape import, re-read, repeat).
2. Coverage generation 4 and the settled re-read, with tests.
3. Matrix `m3` with `m2` carry-forward, with tests.
4. Update generation literals in tests across packages.
5. README levers and progress queries, invariants doc.

## Decisions

- Summary-only re-read instead of the full backfill: 18 provider reads in one
  job instead of 682 in 62, and no timeseries is read, so none can be stored
  under a second id.
- Already-retrying connections are left on the existing tested behaviour
  (ladder restart) rather than teaching the ladder to cross generations.
- Not decided here (owner): individual `fat`, BMI, lean-mass and waist
  readings older than a week stay missing, as does the speed series of older
  workouts. Daily body summaries carry weight, fat and BMI. Recovering the
  individual readings needs those four resources in the extended-history
  matrix, which has room for two more resource columns at its 256-character
  bound, so it is a layout change, not a constant.

## Plan review (ReviewGPT, architecture preset, before implementation)

Verdict: revise before implementing. Four findings, each checked against the
code and dispositioned:

1. P1, the connect-window replay misses summaries imported after connection.
   Accepted. Confirmed in code: `buildInitialJobs` gives a source that joins
   or reconnects later a 180-day backfill ending at its own start, which is
   after the connection date. Built as a second loop in the same job rather
   than one wider request, so no request is longer than the range the
   backfill already uses and later data cannot stand in as evidence for the
   connect window.
2. P2, the bump revives exhausted failures and clears their reconnect marker.
   Accepted, and generalised: a settled window keeps its outcome. The same
   rule stops a complete window from entering the ladder when its re-read
   finds less than before.
3. P2, temporal-authority children survive the summary-only condition.
   Accepted. The measured backfill queued 14 of them and rewrote the sweep
   marker; the settled decision now gates both.
4. P2, rollback can discard an unpublished `m3` matrix. Accepted as a
   correction to the rollback claim (risk 2). Rejected as new merge code: the
   defect is in the already-deployed build's handling of a future envelope,
   which this change cannot alter, and preserving opaque future matrices in
   the new build would serve only a later `m4` nobody has planned.

Also taken from the review: the weight generation fences certification and
job identity, not fetches; an `m3` prefix does not prove weight was re-read
(the progress query counts weight bits per envelope); the weight scan covers
180 days before the day it is scheduled.

## Final review (ReviewGPT, PR round 1)

- First pass: PASS, no findings.
- Second pass on the same head, asked to go deeper: one High. A weight scan
  that read its first chunks before #4954 and then held its cursor through
  incomplete-fetch retries would finish its suffix under this change and
  certify `m3`, because weight was still generation 2. Accepted: the first
  version of this plan kept generation 2 on the argument that such a scan
  restarts from the history start, which is true of a pending-upstream retry
  and false of an incomplete-fetch retry. Fixed by advancing weight to
  generation 3, with a test that the retained scan cannot certify and the full
  scan stays queued. The pass also noted the real-vault test never fetched the
  day a webhook had delivered; it now does and asserts that day gains no event.

## Verification

- `pnpm --dir packages/device-syncd test`: 62 files, 1566 tests pass, exit 0.
- `pnpm --dir packages/device-syncd typecheck`: exit 0.
- The Web and assistant-runtime test files whose generation literals changed
  pass (141 and 261 tests).
- `pnpm complexity:diff` passes with debt down by 3; `provider-requests:guard`,
  `logs:guard`, `docs:drift` and `docs:gardening` pass.
- Each new rule fails a new test when removed (reconnect marker, temporal
  sweep, timeseries continuation, outcome carry-forward, later spans).
- `pnpm test:diff` over the touched paths was started and stopped before it
  finished, to free a shared machine; required CI on the PR head owns the
  broad run.
Completed: 2026-11-14
Completed: 2026-11-14
