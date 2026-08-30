# Bound and diagnose Browser Vault refresh timeouts

Status: active
Created: 2026-08-29
Updated: 2026-08-30

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
- Final ReviewGPT round 3 accepted the architecture retrospective but found one
  merge-blocking composed-owner defect: the existing vault-share projection
  backoff also writes `nextAttemptAt`, so a projection-only delay can be
  mistaken for the one Browser Vault timeout retry. That mislabels the first
  actual refresh as `retry` and can terminalize its first timeout without the
  promised Browser Vault retry.
- The user explicitly resumed remediation on 2026-08-30 with simplicity,
  maintainability, and composability as the priority. The selected direction is
  to derive timeout-retry ownership from the existing projection-failure
  metadata plus `nextAttemptAt`, through one shared predicate used by telemetry
  and both deferral writers. Add no persisted field, counter, enum, or owner.
- ReviewGPT authored that correction as patch SHA-256
  `c620d934ebd5454d36eb9b9caa79f2c75b48fa12c58eba25d5ef46e78f2d80f0`.
  Parent review accepted the shared predicate, reuse of existing projection
  metadata, clearing of projection metadata on the first actual timeout, and
  preservation of timeout-retry ownership through a later projection failure.
  The patch adds no persistent state, alternate owner, telemetry schema, or
  unrelated behavior.
- The first owner-level test run found one test-only expectation mismatch: the
  existing wake owner truthfully returns `reason: "assistant"`, not `null`.
  ReviewGPT supplied the one-assertion test-only revision with SHA-256
  `6398da1ec5c3a60d6438f65b1050158f1b77751bdea43795bf5ec2401f133a5e`.
- Remediation proof is green: the two focused owner/composed tests pass; the
  five-file hosted-runtime regression set passes 184 tests; assistant-runtime
  typecheck and staged diff checks pass.
- Pending: docs/log guards, commit and push, exact-head final ReviewGPT review,
  required CI, Ready state, merge, merge proof, and worktree retirement.
  Production deployment remains explicitly out of scope.

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
- Reuse the existing `nextAttemptAt` and projection-failure metadata together
  to distinguish a projection-only delay from the one Browser Vault timeout
  retry. One shared derived predicate must own both telemetry attempt labeling
  and second-timeout terminalization; add no attempt counter or durable state.
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
4. [completed] Update the draft PR evidence and LOC breakdown, commit with the authenticated
   identity, and fast-forward the existing PR branch without force-pushing.
5. [completed] Have ReviewGPT implement the accepted projection-backoff ownership finding
   using existing metadata and one shared predicate, then run the composed
   before/between-projection-failure proof and focused regression set.
6. [in progress] Push the corrected candidate, run the required later full ReviewGPT round and
   exact-head CI, mark Ready, and merge only after all gates pass. Do not deploy
   production automatically.
