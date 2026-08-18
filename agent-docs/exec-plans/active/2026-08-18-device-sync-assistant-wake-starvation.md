# Device Sync Production Recovery

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
  The remediation regression and the full 282-test Junction provider suite pass,
  and the device-syncd typecheck remains green.
- Typechecks pass for `apps/cloudflare`, `packages/assistant-runtime`,
  `packages/device-syncd`, and `packages/hosted-execution`.
- The diff-scoped verifier completed shell syntax, Node syntax, and the hosted
  stale-name guard before its local run was manually stopped during the next
  guard after 161 seconds; required CI remains the broad verification owner.
- Corrective pull request #1992 is open. Exact-head PR review of the corrected
  head, required CI, protected deployment, and production convergence proof
  remain pending.

## State

Status: active
Updated: 2026-08-18
