# Hosted wake classification follow-up

## Goal

Resolve the accepted ReviewGPT finding from PR #615 without regressing its
no-progress wake liveness fix.

Success criteria:

- A late foreground conversation wake preempts delivery as soon as durable
  assistant input is staged, without waiting for optional projection.
- A late system wake that is retryably blocked or throws prevents the current
  prepared auto-reply from dispatching.
- Clean and no-progress system wakes still allow bounded maintenance and idle
  checkpoint progress.
- The fix stays inside the existing runner, mailbox retry, delivery barrier,
  and foreground-stop owners.
- Focused proof, package verification, required audits, CI, and ReviewGPT pass.

## Constraints

- Preserve the foreground reply critical path and fail-closed delivery
  authority checks.
- Do not add persisted state, a queue, scheduler, timeout, retry owner, wake
  kind, dependency, or cross-plane protocol.
- Reuse existing delivery barrier, mailbox retry, and watcher stop/abort
  behavior.
- Preserve unrelated checkout and ledger work.
- Do not expose private identifiers, payloads, local paths, or secrets in
  committed artifacts or review material.

## Approach

1. Add focused failing coverage for retryably blocked late system import and a
   projection-stalled late conversation import during delivery preparation.
2. Replace the resumed watcher's void drain boundary with one typed
   classification that resolves at conversation staging or after system-lane
   classification.
3. Translate retry/error classifications into the existing pre-dispatch
   barrier path and let the existing foreground stop abort optional projection.
4. Run focused, owner, reverse-dependent, typecheck, and repository guard
   verification.
5. Complete required coverage-write, security/privacy, and task-finish review;
   then commit, push, open the follow-up PR, and run CI with ReviewGPT to zero
   accepted findings.

## State

Complete. The accepted ReviewGPT finding, full-batch boundary discovered during
local review, implementation, focused proof, owner and reverse-dependent
verification, security/privacy audit, coverage-write audit, and parent final
review are complete.

## Evidence

- The retryably blocked late-system regression failed before the correction
  because provider delivery proceeded, then passed after resumed wakes began
  returning typed classification.
- The projection-stall regression failed before the correction because
  delivery preparation waited for optional projection, then passed when
  conversation staging became the classification boundary and foreground stop
  aborted the projection.
- A full-batch regression failed before the bounded system-only classification
  path because delivery proceeded under stale authority. The final path scans
  one system page, requeues the original wake for the next conversation pass,
  and preserves the existing batch-boundary entrypoint test.
- Coverage-write added direct proof that a resumed system import error reaches
  the existing delivery-barrier failure path.
- The final canonical diff lane passed assistant-runtime (1,606 passed, 2
  skipped) and the reverse-dependent Cloudflare app (1,770 passed), together
  with required typechecks and repository guards.
- The independent security/privacy audit found no medium-or-higher issue. The
  final implementation adds no persisted state, queue, scheduler, timeout,
  retry owner, wake kind, dependency, or cross-plane protocol.

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
