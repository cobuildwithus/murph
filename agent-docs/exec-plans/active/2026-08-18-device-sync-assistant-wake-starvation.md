# Device Sync Production Recovery and Interruption Observability

## Goal

Restore queued hosted device-sync progress for the remaining production
failure paths after the bounded-resource rollout and assistant-phase recovery.
Success means foreground work retains priority, usage-blocked assistant work
cannot starve system mailbox maintenance, provider work commits resumable
progress within the hosted maintenance budget, and the affected production
frontiers advance after deployment.

## Evidence

- The bounded-resource rollout, assistant-phase recovery, and its follow-up are
  deployed, but the two observed production frontiers have not advanced.
- One workspace is usage-blocked before assistant execution. The platform
  coerces every default invocation to `system_mailbox`, where a persisted due
  assistant wake causes an immediate assistant handoff before device work. The
  next invocation is coerced back to `system_mailbox`, so the handoff cannot
  complete and the durable device item remains starved.
- Another workspace enters the device lane repeatedly. A large share of its
  passes last approximately the configured 45-second maintenance budget and
  then checkpoint without failure or completed progress.
- Junction root reconciliation fetches every summary resource serially before
  importing or scheduling bounded continuation work. Cancellation releases the
  root job for retry, discarding that in-memory prefix, so slow summary calls can
  repeat indefinitely without a typed provider failure.
- Pull request #1992 merged and shipped the bounded Junction continuation and
  blocked-assistant recovery. A later member incident still advanced
  `lastSyncStartedAt` without advancing completion or recording a typed failure.
  The dirty frontier was already drained, no foreground/model/auth work ran in
  the incident window, and the nearest production deploy completed more than two
  hours earlier with no matching rollout or replacement event.
- That incident's workspace wake advanced to the ordinary six-hour cadence
  instead of the yielded 30-second retry. Service wake projection already takes
  the earliest active reconcile or queued job, so an intact immediate Junction
  continuation would have won. The remaining proven failure class is loss or
  interruption after sync start but before the continuation/completion handoff
  became durable. Existing telemetry cannot distinguish a maintenance timeout,
  foreground yield, invocation preemption, container destruction, another outer
  abort, or an abrupt invocation/checkpoint loss.

## Constraints

- Preserve fresh conversation, accepted completion, and real due assistant work
  ahead of device maintenance.
- Execute only the existing canonical `device-sync.wake` mailbox owner; do not
  add a scheduler, queue, persisted field, polling loop, broad resync, or a
  larger timeout that hides non-resumable work.
- Preserve assistant wake state while platform policy blocks assistant work;
  the platform boundary remains the sole authority for that policy.
- Split provider work only through existing resource-job continuation and
  deduplication contracts, with bounded database and provider fanout.
- Keep provider payloads, member identifiers, and production row contents out
  of code, tests, docs, logs, and PR artifacts.
- Preserve the exact wake/checkpoint and mailbox completion fences.

## Product UX

- Effort: Patch.
- Outcome: A member's connected data keeps its existing freshness and recovery
  behavior while operators gain exact interruption diagnostics.
- Reaches: Existing background Apple Health/WHOOP sync passes during normal,
  delayed, and interrupted hosted execution.
- Proof: A deferred runtime-log transport cannot delay provider work, lane
  return, foreground recovery, or checkpoint/retry handoff; the ordinary
  system-mailbox entrypoint still emits correlated lifecycle records.
- Walkthrough: A connected-data member sees no new surface or step. With a
  degraded log endpoint, provider work and the existing retry/checkpoint path
  continue independently. Result: Ready; the deferred-transport and ordinary
  production-entrypoint regressions pass.

## Plan

1. Pass a one-way platform-policy marker into the hosted request when assistant
   work is blocked. In `system_mailbox`, ignore assistant-wake preemption and
   alarm projection only for that invocation while preserving the assistant
   source in the vault for replay after policy restoration.
2. Add production-shape regressions for the blocked gateway and retain the
   existing normal assistant-handoff behavior.
3. Replace the non-resumable serial summary prefix in yieldable Junction
   reconciliation with the existing full-job continuation contract, preserving
   current summary coverage, profile handling, cadence, and deduplication.
4. Add regressions proving cancellation cannot discard all summary progress and
   that composed provider/database load stays within the existing admission
   contract.
5. Run focused tests and typechecks, scoped coverage verification, ReviewGPT,
   required CI, and protected deployment.
6. Confirm both affected production frontiers and typed runtime markers advance
   after deployment; continue diagnosis if either remains stalled.
7. Enqueue an ordered device-sync pass lifecycle pair around the hosted lane
   without awaiting diagnostic transport. Record only attempt/lease/workspace
   context and bounded stage/outcome/count/presence metadata, so a persisted
   start without a finish identifies abrupt loss without exposing member,
   account, job, payload, resource, or raw error values.
8. Preserve the first cancellation source as a typed reason and distinguish
   foreground yield, deadline timeout, invocation preemption, container
   destruction, generic outer abort, and an otherwise unknown yield. Prove the
   lifecycle pair, timeout stage, first-winner classification, and strict Web log
   parser contract with focused tests and package typechecks.
9. Deploy Web's event-code parser before fully recycling the Cloudflare runner,
   then use the paired attempt markers and checkpoint/container logs to classify
   any recurrence exactly.

## Verification

- Pull requests #1984 and #1985 are merged and deployed. Their focused tests,
  exact-head review, required release checks, and production smoke checks
  passed, but post-deploy frontier inspection proved both residual paths remain.
- Production runtime aggregates prove one cohort does not enter the device lane
  and another repeatedly exits near the maintenance budget. No private row
  contents or identifiers are retained in this plan.
- Product journeys replayed locally: a policy-blocked due assistant source stays
  durable while device work completes and the runner goes idle; a normal due
  assistant still preempts device work; a yieldable reconcile commits one
  normalization-safe summary unit per continuation and reaches finalization;
  sleep and sleep-cycle remain paired in one import; an inner summary provider
  failure performs one bounded attempt and reaches typed job failure.
- `packages/hosted-execution` runtime-control tests pass (32 tests), including
  the exact-true request marker parser.
- The focused assistant-runtime gateway tests pass (2 selected of 327), and an
  earlier full entrypoint pass completed all 327 tests before the final alarm-
  projection assertion was added. Two exact-current broad reruns lost their
  local Vitest worker result under concurrent repository load; required CI owns
  the broad exact-head rerun.
- The full Junction provider suite passes (282 tests); device-syncd provider-
  manifest and config suites pass (73 tests); the full Cloudflare runner-alarm
  suite passes (152 tests).
- The independent ReviewGPT incident review validated both root causes and
  identified coupled sleep normalization as a required continuation invariant.
  The remediation regression and the full 285-test Junction provider suite pass,
  and the device-syncd typecheck remains green.
- The preliminary specialist review found three accepted gaps. The restored-
  policy journey now proves a default pass sends one terminal reminder intent
  and a later pass cannot duplicate it. The yieldable provider inventory is one
  eight-second attempt with a 64-provider admission bound and fixed local-source
  reads. A real SQLite service test reconstructs the service between summary
  continuations and proves one successor, stable window/dedupe/cadence, one
  fetch per resource, and no watermark advance before terminal timeseries work.
- The exact remediation suites pass: all 406 Junction provider and service
  tests, all 327 hosted workspace-entrypoint tests, all 152 Cloudflare runner-
  alarm tests, and the focused two-test Web owner-release route selection.
- Typechecks pass for `apps/cloudflare`, `packages/assistant-runtime`,
  `packages/device-syncd`, and `packages/hosted-execution`.
- The diff-scoped verifier completed shell syntax, Node syntax, and the hosted
  stale-name guard before its local run was manually stopped during the next
  guard after 161 seconds; required CI remains the broad verification owner.
- Corrective pull request #1992 merged and its bounded continuation/recovery
  behavior was present before the later incident. The later incident therefore
  does not reproduce the original non-resumable serial summary prefix; it exposes
  the missing terminal-handoff observability described above.
- Final ReviewGPT round one found two accepted cross-runtime gaps. A blocked
  assistant source was retained in the vault but omitted from the owner-visible
  checkpoint wake, so policy restoration had no guaranteed trigger. The
  Junction manifest's new summary continuation fields were also absent from the
  generic retained-wake parser, so recovery could reject an otherwise
  successful tranche at persistence time.
- The remediation keeps assistant execution, preemption, and immediate-recheck
  suppressed while policy is blocked, keeps every assistant source durable,
  and projects the assistant wake when no model-free continuation remains. Its
  focused journey drains device work without entering the model, retains an
  assistant wake, then sends exactly once after policy restoration. The
  retained-wake allowlist now accepts the two
  manifest-owned summary fields while continuing to reject unknown fields. A
  focused recovery test carries a Junction summary cursor through durable
  mailbox serialization, reload, and cold service reconstruction with the same
  dedupe and retry authority.
- Final ReviewGPT round two accepted the retained-wake correction but required
  a retrospective because merging every candidate into the scalar workspace
  wake let an ineligible due assistant mask a future model-free device
  continuation. The retrospective is recorded on the pull request: keep the
  existing scalar owner, derive the next actionable obligation under current
  policy, and add no queue, scheduler, polling loop, state field, or lifecycle.
- The corrected blocked-policy journey now drains a due device item, publishes
  an exact future retained device continuation ahead of the ineligible
  assistant, restores that continuation from a persisted snapshot in a second
  blocked pass, and only then falls back to the still-durable assistant wake.
  Policy restoration produces one terminal reminder delivery and a later pass
  cannot duplicate it. The full 327-test workspace-entrypoint suite, 103-test
  hosted device-runtime suite, 152-test Cloudflare alarm suite, and all affected
  typechecks pass on the correction.
- Final ReviewGPT round three accepted the scalar-wake and retained-payload
  corrections, then found review-induced scope drift in the Junction inventory
  bound: the raw-row check lived in the shared transport parser, before valid
  sibling provider rows were normalized, so it could block revocation, source
  status, diagnostics, and historical work outside the bounded-summary lane.
- The required round-four retrospective is recorded on the pull request. The
  correction is revert-and-shrink: delete the shared raw-row guard, retain the
  single 64-source bound after provider-slug normalization at the database
  fanout owner, and make that existing branch return the typed provider-limit
  error. Existing tests now use more than 64 raw sibling rows across yieldable
  collection, non-yieldable backfill, diagnostics, whole-account revocation,
  and exact-source revocation/status, while 65 distinct logical sources still
  fail before source reads or writes. The focused six-test proof passes.
  The full device-syncd suite passes all 1,128 tests, and its typecheck is green.
- The preliminary specialist review found three accepted gaps in the first
  observability candidate: direct lifecycle transport could consume the lane
  budget, the top-level system-mailbox entrypoint omitted invocation context,
  and late failures reported zero already-processed jobs. The correction uses
  the existing ordered runtime-log buffer, threads the existing context at the
  missing call site, and extends the existing pass observer with the processed
  count; it adds no state, queue, scheduler, retry owner, or schema.
- The corrected 92-test maintenance suite proves provider work and retry-wake
  return complete while the first lifecycle transport remains blocked, retains
  lifecycle ordering/correlation after release, and reports a nonzero job count
  on a later reconciliation failure. The full 338-test workspace-entrypoint
  suite proves the ordinary `system_mailbox` path emits both markers with the
  request attempt, lease generation, and workspace version. The assistant-
  runtime typecheck passes.
- The independent first-round review reported one High finding: awaited
  lifecycle telemetry could exhaust the maintenance budget and retain the
  foreground fence. This duplicates the accepted specialist transport finding
  and is corrected by the same existing-buffer reuse and deferred-transport
  regression. It reported no additional defect. The consolidated five-file
  assistant-runtime regression run passes all 798 tests, and the package
  typecheck remains green.

## State

Status: active
Updated: 2026-08-20
