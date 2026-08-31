# Runtime progress review remediation

Status: active
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Finish the existing cross-repository non-starvation patch so unchanged
  device work cannot hide or interrupt a due reminder, including across
  retry, signal, and Temporal continue-as-new boundaries.

## Success criteria

- The runtime derives the canonical mailbox wake and independent earliest
  default-owned mailbox wake from one local-state read.
- Temporal retains unsuccessful system retry ownership in the existing
  progress backoff before any interruptible return or wait.
- A facts-only reconciliation signal cannot duplicate an already-accepted
  default pass across continue-as-new, while real mailbox/provider signals
  retain their existing prompt handoff behavior.
- Focused public and private regression tests pass, existing Temporal histories
  replay, and the exact 113-job cross-repository journey delivers exactly one
  due reminder while 13 jobs remain before the backlog converges.
- Both exact-head PRs satisfy required ReviewGPT and CI gates.

## Scope

- In scope:
- Public mailbox wake derivation and focused state/entrypoint coverage.
- Private Temporal retry retention, accepted-pass ownership, workflow tests,
  replay proof, and cross-repository pin updates.
- Exact-head PR evidence, ReviewGPT remediation, and CI.
- Out of scope:
- A new queue, scheduler, retry owner, database state, or runtime capability.
- Changing reminder content, automation semantics, or device-sync job limits.
- Production deployment before both compatible PRs are merge-ready.

## Constraints

- Technical constraints:
- Preserve one-way ownership: runtime-local mailbox state owns local retry
  deadlines; Temporal remains pointer-only and stores only its existing
  bounded progress backoff.
- Preserve Temporal determinism, patch markers, workflow names, task queues,
  signal contracts, and continue-as-new state.
- Default, foreground, provider, and retention work must bypass the system
  fuse without clearing it.
- Product/process constraints:
- Product UX effort is Patch. Outcome: a requested recurring reminder arrives
  at its due time during device backlog. Reaches: the existing scheduled
  message journey. Proof: provider entry, exactly-once Linq delivery, unfinished
  13-job backlog at delivery, two bounded device passes, and next recurrence.
- Keep both PRs draft until focused proof, parent review, exact-head specialist
  and final gates, and required CI are complete.

## Risks and mitigations

1. Risk: Independent default selection leapfrogs an earlier item on the same
   serialization key.
   Mitigation: Derive both candidates from the same already-serialized frontier
   and classify only the first item for each key.
2. Risk: Unsuccessful retry retention accidentally escalates the progress fuse.
   Mitigation: Preserve the matching level and only clamp `notBefore`; create
   level zero for a new fingerprint.
3. Risk: Preserving an accepted default pass hides newly arrived real work.
   Mitigation: Preserve only across facts-only rechecks; mailbox and provider
   wake versions still invalidate the accepted owner.
4. Risk: A unit fix misses the production overlap.
   Mitigation: Re-run the pinned real Temporal/public runtime journey with 113
   jobs, the real 100-job cap, a held provider response, and database-backed
   runtime evidence.

## Tasks

1. [x] Recover exact PR heads, failed-run evidence, and ReviewGPT artifacts.
2. [x] Independently reproduce and accept or reject each reported finding.
3. [x] Implement the smallest public and private owner-level corrections.
4. [x] Add focused regression coverage for future default deadlines,
   unsuccessful retry signals/default preemption, and accepted-pass
   continue-as-new ownership.
5. [ ] Run focused tests, typechecks, Temporal replay, and cross-repository E2E.
6. [ ] Push exact candidates and complete ReviewGPT, CI, PR evidence, and final
   parent review.

## Decisions

- Accept the public ReviewGPT finding: one classified mailbox candidate cannot
  encode a future default retry behind independent device work.
- Accept the private ReviewGPT finding: retry ownership must be stored before
  signal-sensitive control flow.
- Treat the pinned E2E failure as a separate accepted-owner race: a facts-only
  recheck may reconcile immediately, but it must not re-admit an active default
  pass or let continue-as-new forget that pass.
- Reuse existing owners and delete no supported flow; add no state machine or
  service.
- Count canonical device-import progress at its existing receipt checkpoint;
  keep local device queue completion as telemetry rather than generation
  authority, so cold replay cannot manufacture progress.
- Bound a retained accepted default owner by its recommended recheck horizon;
  reconciliation failure preserves ownership only while that horizon remains
  in the future.

## Verification

- Commands to run:
- Focused assistant-runtime mailbox-state and workspace-entrypoint Vitest.
- Focused private workflow Vitest covering retry/default/signal/continue-as-new.
- Public and private affected-package typechecks and repository-required verify
  commands.
- Private replay fixtures plus the real Temporal integration lane.
- Exact public/private SHA-pinned 113-job non-starvation GitHub job.
- Exact-head preliminary/final ReviewGPT and required GitHub checks.
- Expected outcomes:
- Canonical device wake and independent future default wake coexist.
- No unchanged system probe begins before its retained retry deadline.
- One default pass survives a facts-only signal and continue-as-new pressure.
- The reminder enters the provider once, delivers once while 13 device jobs
  remain, the backlog drains in 100+13 jobs, and the next recurrence is
  projected.
