# Detect stalled and repeatedly interrupted device imports

Status: completed
Created: 2026-09-15
Updated: 2026-09-15

## Outcome and invariant

Alert operators when retained device work stops saving progress, repeatedly
cycles without useful work, or drains for over an hour. Healthy wake RPCs and
unrelated checkpoints must not cause pages or conceal stalled imports.

## Evidence and ownership

The existing runtime-progress monitor ages pending mailbox items; durable
transfer into retained device jobs can clear that mailbox while imports remain.
The device pass and checkpoint log producers already expose bounded metadata
for pending jobs, continuation fingerprints, cancellation and Web acceptance.
Derive health from that evidence and current canonical runtime-access decisions.
Reuse the latency cron, isolated log pool and operational email incident owner.
No scheduler, schema, provider credentials or member-facing behavior changes.

## Decisions

- Stall: 15 minutes without checkpointed continuation progress.
- Cycling: four starts or outer cancellations in 20 minutes, with fewer than
  two checkpointed progress passes. Wake RPCs do not count as starts.
- Backlog: one hour of observed continuous pending work with recent passes;
  gaps over 15 minutes do not prove continuous processing.
- Applied imports count even when a pass has no retained continuation; no-op
  imports alone do not. Only an accepted checkpoint from the matching attempt
  credits progress or confirms an empty queue for that connection. Unknown queue metadata does not establish recovery.
- One shared initial observation; each possible email rereads health before
  admission. Three incidents run serially and reuse existing send leases,
  idempotency, six-hour reminders and silent recovery. Only stalls bypass
  quiet hours. Send no identifiers or raw diagnostic payloads.
- Each observation admits at most 1,000 active connection owners and 50,000
  relevant log events in two hours. Truncation and query failure fail visibly.
  At most four primary reads and one log read execute serially per observation;
  the initial read plus three admission rereads totals at most 16 primary and
  four log reads, excluding the existing bounded singleton incident writes.
- Evaluate queue/progress evidence per hashed connection identity. Aggregate
  distinct affected runtimes and runtime starts only after classification.
  Match checkpoints to connections that emitted passes in the same attempt;
  do not broadcast every checkpoint to every connection.
- The additive Web reader excludes legacy/malformed connection keys. Deploy
  Web before the runner when needed; coverage begins with keyed observations.
  The runner adds one digest to existing diagnostics. No schema migration.

## Tasks

1. Complete classifier, bounded SQL reader and cron integration.
2. Prove saved-progress, recovery, cycling, privacy and maximum-cardinality paths.
3. Run web typecheck, focused PostgreSQL and incident-owner tests, complexity
   and parent review; update durable owners and open the draft PR.
4. Complete exact-head CI and final ReviewGPT, then merge/deploy within the
   existing delivery authorization and verify the cron outcome.

## Verification

- Focused classifier/monitor/cron run: 27 tests passed.
- Existing progress and latency incident-owner regression suites: 66 passed.
- Local PostgreSQL diagnostic projection: passed, including malformed fields,
  start-versus-wake classification and private payload exclusion.
- Web typecheck and ESLint passed after the recovery correction.
- Complexity guard passed; no changed function exceeds 20. Parent review
  confirmed scope, privacy, chronology, bounded reads and unchanged admission.
- PR CI and final ReviewGPT remain pending.
- Changelog: not applicable; internal operator monitoring only.

## Review round 1 disposition

- Reviewed head: `6628ed6c5fa58ae6771fe18ab6bde1364b34526b`.
- Result: one High ORIGINAL_PR finding, accepted; no rejected findings.
- Cause: the producer reads a connection-local queue, while the classifier
  grouped only by runtime. Another connection's checkpointed empty queue could
  silently recover the stalled connection. Parent reproduced this with synthetic
  observations and verified the supported interleaving scheduler path.
- User resumed remediation. The correction adds connection ownership to the
  existing diagnostic, groups evidence by that key and preserves distinct
  runtime counts. No new durable state or runtime scheduling behavior.
- Round 1 exact-head CI finished green. Round 2 is required after correction.
- Corrected focused Web tests: 31 passed; local PostgreSQL projection: passed;
  parsed runtime producer test: passed. Web and assistant-runtime typechecks
  passed. Complexity guard passed; existing maintenance hotspots are unchanged.
- An initial package test invocation included an extra argument separator and
  started broader proof than intended. Its proven session-owned process tree
  was stopped; the explicit focused Vitest command then passed.

## Review round 2 disposition

- Reviewed head: `dd935d2a4919b94d915cfc55aa5899f696a67c2d`.
- Validated GPT-6 Pro response and capture hashes; one High ORIGINAL_PR finding
  accepted. The connection-isolation correction was confirmed.
- A late control-plane failure emits a local queue snapshot and empty fallback
  outgoing fingerprint, but the checkpoint saves the original retry obligation.
  The old projection incorrectly credited continuation progress or recovery.
- User resumed remediation. The projection now requires a completed or yielded
  pass for fingerprint progress and empty-queue recovery. Failed incoming retained
  jobs and positive local queues remain pending; proven applied imports can still
  receive checkpoint credit. No producer, scheduler or durable-state change.
- A shared synthetic fixture is asserted against the real failure producer and
  passed through PostgreSQL and the classifier. Both zero/one local-job cases
  failed before correction and passed afterward. Recovery requires a subsequent
  successful drain and accepted checkpoint; applied-import credit is preserved.
- Focused PostgreSQL: 3 passed; runtime failure producer: 2 passed; Web monitor,
  classifier and cron: 31 passed. Web and runtime typechecks passed.
- Round 2 CI: 34 checks passed; platform-a failed one foreground trace-count test
  (13 versus 6), also failing its aggregate gate. Its isolated local reproduction
  passed; do not classify the CI failure as resolved until exact-head CI passes.
- Changed Web files pass ESLint; complexity guard passes with unchanged existing
  hotspots. Parent review confirmed the fix stays at the projection boundary.
- Round 3 final review and exact-head CI remain pending.

## Final parent review and handoff

- Round 3 reviewed `d0b89ff08b43a6268914e02913bdcc34896b4b07`: PASS.
  GPT-6 Pro model and exact response/capture SHA-256 match; both accepted
  findings are resolved. Review completed beyond its minimum response time.
- Parent final review confirmed connection ownership, failed-pass semantics,
  accepted-checkpoint credit, bounded queries, admission and privacy. No new
  abstraction or further production edit is justified.
- Implementation and local verification are complete. Final plan closure is
  explanatory documentation only and does not alter the reviewed behavior.
- Delivery remains tracked by PR #3488: require green exact-final-head CI,
  current-base mergeability, protected merge, managed Web admission and the
  protected Cloudflare deployment before claiming production completion.
Completed: 2026-09-15
