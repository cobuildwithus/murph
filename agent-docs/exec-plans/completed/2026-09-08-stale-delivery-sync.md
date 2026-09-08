# Recover device sync behind stale delivery wakes

Status: completed
Created: 2026-09-08
Updated: 2026-09-08

## Outcome and invariant

Retire a disproved overdue assistant-delivery projection so queued device work
can regain runtime ownership. Preserve real pending deliveries, fresh foreground
input, future schedules, workspace CAS, and system progress accounting.

Product UX effort: Patch.
Outcome: Background health imports resume after a completed delivery.
Reaches: Hosted members with an obsolete delivery wake and pending device work.
Proof: Synthetic production-owner replay must fail before implementation and
pass afterward, including the persisted correction and subsequent ownership.

## Owner and evidence

The assistant phase owns live default-work evaluation. The workspace checkpoint
owns its durable wake projection; Temporal consumes that projection. Existing
stale-wake verification excludes the assistant_delivery reason. A guard-only
probe established the exclusion but does not establish the composed failure.
No member identifiers, logs, health data, or copied production rows belong here.

## Work

1. Reproduce using the real assistant phase and runtime checkpoint path with
   synthetic stale delivery state and a real pending device mailbox item.
2. Only after failure, extend the current verification/checkpoint owner with
   the smallest correction. Check actual outbox authority before retiring a
   delivery wake; preserve due and future delivery work and lookup failures.
3. Verify persistence and a second invocation, focused suites, typecheck,
   complexity, docs and changelog proof. No model journey is needed when only
   deterministic wake selection changes and model inputs remain unchanged.
4. Review, close this plan, commit and open a scoped PR; run required final
   ReviewGPT and exact-head CI. No overlapping runtime implementation.

## Deployment and residual scope

A runner image release is required; a Worker-only deployment cannot ship this
change. Persisted shapes and consumers remain unchanged. Other stalled queues
are separate investigations; this task does not claim their recovery.

## Progress

- Fresh isolated checkout and current open PRs inspected; no matching wake fix.
- Before any source edit, three actual assistant-phase regressions failed for
  delivery wakes while their ordinary assistant counterparts passed.
- The composed runtime restore/actual phase/checkpoint replay then failed at
  the durable checkpoint assertion: no checkpoint was written with pending
  device work and an obsolete delivery projection.
- Implementation now admits delivery projections to the existing verification
  path and checks the authoritative outbox before retiring an overdue wake.

- Corrected checkpoint replay passes and a fresh restore of that exact snapshot
  enters device sync and handles the pending item without an assistant model
  pass. No live payload drain is claimed by this synthetic test.
- Added due/future outbox preservation, outbox read failure, due/future cron,
  and second-pass regression coverage. Existing delivery, foreground input,
  device-sync and scheduling suites cover adjacent success paths.
- Complexity guard passes with unchanged debt and unchanged existing hotspots;
  the two edited helpers remain below the threshold. No new owner or abstraction.
- Focused verification: all 337 runtime tests across foreground, scheduling,
  delivery, device-sync and entrypoint scheduling pass across the final affected
  runs; assistant-runtime typecheck passes. Changelog rendering: 9 tests pass.
- PR #3048 opened as draft. Parent candidate review complete; final ReviewGPT
  and exact-head CI remain pending before completion.
- Final ReviewGPT round 1 passed at `3f2da00c8f36`; response identity and
  actual `gpt-6-pro` model were verified against capture metadata. No accepted
  findings or implementation changes remain. Parent final review agrees.
- Exact-base docs drift passes after indexing the updated runtime contract.
  Merge-tree comparison with current main is clean. Required final-head CI
  and any production rollout verification remain tracked by PR #3048.
- Product replay disposition: Ready. The observed scheduling failure is
  reproduced and corrected; the initial event leaving an obsolete projection
  and live backlog drainage are not established by these local tests.
Completed: 2026-09-08
