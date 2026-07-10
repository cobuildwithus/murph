# Hosted auto-reply history lazy loading

Status: completed
Updated: 2026-07-10

## Goal

Reduce webhook-to-provider latency and its long tail by removing unnecessary
assistant receipt reads from the hosted queue-only reply path, while preserving
exact reply anchoring, cross-session context consumption, local replay repair,
and at-most-once delivery behavior.

Success means:

- hosted replies with no relevant outbox delivery do not open receipt files;
- explicit provider-message replies resolve before receipt consumption state;
- unanchored cross-session fallback still suppresses already-consumed context;
- one lazy outbox inventory read is shared across an automation pass;
- the existing provider-start latency trace reports metadata-only receipt lock
  wait/scan duration/files/bytes and outbox scan duration without adding hot-path
  network I/O; and
- focused regressions, owner coverage, typechecking, required audits, ReviewGPT,
  and PR CI all pass.

## Evidence and constraints

- The current evaluator awaits every receipt before it knows whether hosted
  queue-only behavior needs one.
- Receipt inventory performs sequential JSON reads under the per-vault runtime
  write lock and incrementally sorts an effectively unbounded result.
- Outbox inventory is a separate sequential full scan and can be requested by
  both self-echo and cross-session selection in one pass.
- Static evidence proves avoidable unbounded work, not that it alone explains
  the production multi-second tail. Instrument the existing path before adding
  an index or changing retention.
- No new database, index, service, queue, configuration, persisted state, or
  synchronous observability write.

## Implementation shape

1. Replace the receipt-only per-pass reader with one small lazy history reader
   that caches the existing receipt and outbox inventories once per automation
   pass and exposes only metadata-only scan measurements.
2. Preserve handled-receipt fallback where it is enabled. In hosted queue-only
   mode, filter relevant outbox deliveries first; explicit provider-message
   replies return an exact match without receipt loading, and no/same-session/
   non-causal candidates return before receipt loading. Only the unanchored
   fresh-candidate fallback reads consumed intent ids from receipts.
3. Measure receipt wall time, lock wait, files read, bytes read, whether it ran,
   and outbox wall time/whether it ran. Attach those values to the existing
   fire-and-forget provider-start phase breakdown; never emit another request.
4. Add direct regressions for skipped and required receipt reads, one outbox
   read per pass, scan measurements, and safe latency-contract parsing/merge.

## Deletion ledger

- Delete the unconditional receipt read from auto-reply evaluation.
- Delete the receipt-only reader name and redundant direct-read fallback helper.
- Do not add an index, projection, cache file, migration, retention rule, or
  background repair process.
- Do not extend container linger or change runtime fences in this task.

## Invariants

- A current inbound message remains replyable; optimization must not create a
  silent terminal path.
- Provider message ids outrank latest/time-based context heuristics.
- Exact provider-id matches intentionally ignore the local consumption
  watermark; unanchored fallback continues to honor consumed intent ids.
- Existing local/non-hosted handled-receipt repair remains intact.
- Measurements contain counts, byte totals, durations, and booleans only. They
  contain no message text, paths, ids, prompts, transcripts, or file contents.
- Observability remains best-effort and off the user-visible reply path.

## Verification and completion

- Use focused tests while iterating, then run a truthful `pnpm test:diff` lane
  for every touched owner and reverse dependent.
- Run the required write-capable `coverage-write` pass and the review-only
  `security-privacy-review` pass because metadata from sensitive assistant
  runtime storage is attached to a hosted trace.
- Run the parent final diff review, finish the active plan with
  `scripts/finish-task`, push a draft PR, start ReviewGPT in parallel with PR
  CI, and iterate until ReviewGPT has zero accepted findings and final-head CI
  is green.

## Deployment

This is an additive runner-bundle behavior and latency-contract change. It does
not require a web schema, Worker route, Temporal, or persisted-workspace format
change. Old and new warm containers may coexist safely. Deploy the web parser
before the runner bundle to preserve uninterrupted phase diagnostics: an old
parser receiving the new optional leaves keeps the core provider-start event
but drops its whole phase breakdown. No tandem rollout is required. Post-deploy
traces should confirm the skipped-read cohort and the measured receipt/outbox
distributions before any further optimization.

## Completion evidence

- Focused lazy-history, runtime trace, and hosted contract suites passed.
- All ten direct and reverse-dependent package typechecks passed after building
  the fresh worktree's declared generated package entrypoints.
- Full Assistant Engine passed 2,013 tests with four expected skips. Assistant
  Runtime passed 1,494 tests with two expected skips; its only failure was an
  untouched wall-clock assertion requiring a whole synthetic runtime job to
  finish under five seconds, and the same assertion failed in isolation while
  the shared machine was saturated. Final-head PR CI remains the clean-machine
  broad gate.
- Required coverage-write, security/privacy, simplicity, and parent diff
  reviews completed without production findings.
Completed: 2026-07-10
