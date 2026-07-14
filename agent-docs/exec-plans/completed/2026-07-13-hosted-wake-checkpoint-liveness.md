# Hosted wake checkpoint liveness

## Goal

Stop repeated non-conversation runtime wakes from starving hosted background
maintenance and the runtime-owned idle checkpoint.

Success criteria:

- Reproduce the production interaction between a pending device-sync wake,
  repeated source-less/system wake signals, and the idle checkpoint boundary.
- Preserve immediate preemption for newly imported conversation work.
- Let already-imported or non-advancing system wake hints coexist with bounded
  device-sync maintenance and checkpoint progress.
- Keep durable mailbox, device-sync, checkpoint, and scheduling ownership
  unchanged.
- Land the smallest maintainable correction with focused regression coverage,
  required verification, an open PR, green CI, and a zero-accepted-finding
  ReviewGPT round.

## Constraints

- Preserve foreground conversation priority and fail-closed authority checks.
- A wake remains a droppable latency hint; imported and handling progress stay
  distinct.
- Do not add persisted state, a scheduler, queue, retry owner, signal kind, or
  cross-plane protocol.
- Preserve unrelated checkout and ledger work.
- Do not expose private identifiers, payloads, local paths, or secrets in
  committed artifacts or review material.

## Approach

1. Trace the current wake-consumption and background-yield call paths from the
   production incident evidence.
2. Add a focused failing test for repeated non-conversation wake hints while a
   due device-sync wake and dirty checkpoint are pending.
3. Resume the existing foreground mailbox watcher after the pre-delivery
   system barrier and drain only the wake already delivered to it, so actual
   conversation progress preempts maintenance while no-progress nudges do not.
4. Run package coverage/diff verification and direct scenario proof.
5. Complete the required security/privacy and coverage audits, parent review,
   scoped commit, PR, CI, and ReviewGPT loop.

## State

Complete. The implementation, focused lifecycle proof, owner-level diff lane,
security/privacy audit, coverage-write audit, and parent final review are green.

## Evidence

- Production showed the same already-imported system pointer re-signalled each
  minute while a device-sync reconcile wake remained overdue.
- The pre-delivery system barrier permanently stopped the foreground mailbox
  watcher, so later source-less wakes bypassed mailbox classification and were
  converted directly into foreground pressure.
- Focused runner and entrypoint scenarios prove that a wake already pending at
  the barrier and one delivered immediately afterward are drained before the
  watcher stops; conversation progress still preempts, while no-progress wakes
  leave background maintenance eligible.
- The long-lived invocation then encountered a bounded runtime-wake timeout and
  later an outer transport timeout around checkpoint completion.
- Focused runner and entrypoint verification passed all six watcher lifecycle
  scenarios, including both projection-stall abort paths.
- The canonical diff lane passed assistant-runtime (1,580 passed, 2 skipped)
  and the reverse-dependent Cloudflare app (1,759 passed), together with all
  required typechecks and repository guards.
- The independent security/privacy audit found no medium-or-higher issue; the
  coverage-write audit found no missing stable-boundary proof and made no edit.
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
