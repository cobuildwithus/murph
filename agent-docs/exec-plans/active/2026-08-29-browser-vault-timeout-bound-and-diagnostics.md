# Bound and diagnose Browser Vault refresh timeouts

Status: active
Created: 2026-08-29
Updated: 2026-08-29

## Progress

- ReviewGPT authored the complete implementation against exact PR head
  `cda255523902359958a666e0e8f30f8de06534e0`; the accepted production patch
  SHA-256 is
  `36c44a91d50c51a81e8bf4e66fd1d5cf604a3b739b9979574083aee024916a07`.
- Parent review accepted the patch after checking retry boundedness, earlier
  deadline capping, joined cancellation, telemetry privacy/cardinality, runtime
  overhead, device-sync separation, and reuse of the existing mailbox and phase
  log owners.
- The first focused run found one new composed-test fixture error: its claimed
  model-free successor used a default-owned notification key and was eligible
  before the Browser Vault retry. ReviewGPT diagnosed it and authored a
  one-file test-only revision with SHA-256
  `5b02f6eea17e32c707099d1417637cdfbeb83b24eca77b211a174d58b0916a8e`;
  no production behavior changed in that revision.
- Focused proof is green:
  - the isolated second-timeout/successor journey: 1 passed;
  - the four-file hosted-runtime regression set: 124 passed;
  - assistant-runtime typecheck;
  - docs drift;
  - changelog archive test: 9 passed;
  - Web typecheck;
  - staged diff check.
- Changelog review classifies this as a priority-3 member-visible reliability
  improvement. The existing item now states the exactly-one retry and terminal
  second-timeout boundary; no visual is warranted for this content-only entry.
- Pending: intermediate candidate commit/push, PR evidence refresh, full later
  ReviewGPT round on the exact pushed head, exact-head required CI, Ready state,
  merge, merge proof, and worktree retirement. Production deployment remains
  explicitly out of scope.

## Goal

- Complete PR #2515 with exactly one delayed Browser Vault timeout retry,
  increase the default refresh deadline from 20 to 30 seconds, and extend the
  existing timeout log so natural production traffic can identify where the
  deadline was consumed.

## Success criteria

- The first `deferred_timeout` retains the exact Browser Vault item and keeps
  the existing 60-second delayed wake.
- A second timeout on that retained item is terminal: the item is recorded and
  removed, handled-through advances, a successor model-free item becomes
  selectable, and no third refresh is attempted.
- The default refresh deadline is 30 seconds and remains capped by an earlier
  invocation deadline; foreground/runtime-wake/abort cancellation remains
  immediate.
- Timeout telemetry answers whether the budget was consumed before or inside
  the current operation, and whether the event came from the initial attempt
  or the one retry, using only typed bounded fields and the existing hosted
  phase log.
- Focused tests, affected typechecks, privacy/log guards, docs drift, exact-head
  ReviewGPT, and required GitHub checks pass before merge.

## Scope

- In scope: the existing Browser Vault refresh deadline, the exact retained
  item retry bound, focused tests, the existing `browser_vault.refresh` log
  details, the hosted-runtime protocol, PR evidence, and changelog wording only
  if the shipped claim needs adjustment.
- Out of scope: new schedulers, queues, state owners, persisted fields,
  observability backends, raw timing traces, vault contents, device sync,
  production deployment, or synthetic production traffic.

## Evidence and telemetry question

- Production already proves timeouts at the closed stages
  `initial_source_hash`, `replica_construction`, `replica_serialization`,
  `second_source_hash`, `replica_write`, and `ref_publication`.
- Existing `runtimePhaseDurationMs` proves total refresh duration, but the log
  cannot distinguish these concrete hypotheses:
  1. the current stage itself consumed most of the deadline;
  2. earlier stages consumed the budget before the reported stage began;
  3. the coarse `replica_construction` stage is slow in source reading,
     outcome reading, or in-memory replica projection;
  4. timeouts concentrate on the delayed retry rather than the initial
     attempt.
- The smallest useful extension is the existing timeout event plus a closed
  current-step value, initial-versus-retry attempt value, configured timeout,
  total refresh elapsed time, and current-step elapsed time. Reuse the phase
  log; add no identifiers, paths, filenames, hashes, contents, payloads, or raw
  errors.
- Later verification query: on a bounded natural post-deploy window, filter
  `details.browserVaultRefreshStatus = deferred_timeout`; aggregate count and
  p50/p95 (or fixed buckets) by refresh stage, fine step, and attempt, comparing
  total elapsed, current-step elapsed, source file-count/byte buckets, and
  terminal publication/removal evidence. Generate no synthetic traffic.

## Constraints

- ReviewGPT exclusively authors production-code and telemetry changes. Apply a
  returned patch only after verifying scope, privacy, cardinality, runtime
  overhead, retry boundedness, and current-main compatibility.
- Reuse the existing `nextAttemptAt` value as the one-retry marker rather than
  adding an attempt counter or durable state.
- Telemetry must remain metadata-only, fixed-schema, bounded-volume, and
  behavior-preserving outside the explicitly requested timeout increase.
- Preserve foreground reply priority and every existing host-abort,
  runtime-wake, shutdown, write-fence, source-change, publication-conflict, and
  terminal-outcome behavior.

## Tasks

1. [completed] Give ReviewGPT the accepted final-review finding, 30-second deadline change,
   exact telemetry question, privacy/cardinality constraints, and focused proof
   requirements.
2. [completed] Inspect and apply only a complete safe ReviewGPT patch.
3. [completed] Run the timeout-timeout terminal scenario, deadline/cancellation tests,
   telemetry-shape tests, focused hosted-runtime suites, typechecks, privacy/log
   guards, docs drift, and diff checks.
4. [in progress] Update the draft PR evidence and LOC breakdown, commit with the authenticated
   identity, and fast-forward the existing PR branch without force-pushing.
5. [pending] Run the required later full ReviewGPT round and exact-head CI. Mark Ready and
   merge only after all gates pass. Do not deploy production automatically.
