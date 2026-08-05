# Foreground priority full-stack hosted-local proof

## Goal

Add a deterministic hosted-local full-stack regression that proves durably
accepted conversation input cannot lose foreground admission to a new
interruptible checkpoint attempt.

The proof must cross the real local hosted boundaries: Web acceptance and
mailbox persistence, runtime signaling, Cloudflare coordination, runner
checkpointing, mailbox import, provider start, and accepted Linq delivery.

## Success criteria

- Reproduce the exact snapshot-interruption race whose first foreground probe
  is empty before the later causal conversation row and wake become visible.
- Prove with typed ordering evidence that the accepted conversation is imported
  and reaches provider start before any retry snapshot begins.
- Cover the canonical-publication exception: once publication is
  non-interruptible it may finish, but the accepted conversation must be the
  immediate continuation before another checkpoint attempt.
- Preserve existing proofs that ordinary empty wakes do not indefinitely defer
  durability and that system-only work, shutdown, and provider handoff keep
  their established authority.
- Avoid timing thresholds as the primary correctness oracle; use deterministic
  test-owned barriers and bounded waits only for liveness.

## Constraints

- Reuse the hosted-local harness, real test database, Worker/Durable Object,
  runner bundle, provider stub, and Linq stub.
- Keep every control test-only and fail-closed behind existing hosted-local
  control admission.
- Add no production scheduler, queue, persisted state, polling owner,
  correlation protocol, or product behavior.
- Prefer one composable barrier or observation seam over phase-specific test
  machinery.
- Keep diagnostics and fixtures synthetic, bounded, and free of private user
  evidence.

## Approach

1. Have ChatGPT Pro inspect the merged fix and current hosted-local harness, then
   return a scoped patch implementing the smallest complete full-stack proof.
2. Treat the patch as intent: inspect its authority boundary, remove accidental
   complexity, and verify the exact race locally.
3. Run focused package tests and typechecks, then the required PR review and CI
   gates.

## State

Implementation and focused verification complete.

- The observer records a bounded, typed per-user sequence across snapshot
  start, checkpoint start/commit, mailbox fetch completion, and provider start.
- Test-only barriers deterministically hold an interrupted snapshot start, its
  exact rearm conversation probe, or a committed canonical publication.
- The runtime now rearms an interrupted idle checkpoint even when a parallel
  foreground waiter consumed the optional wake-notification timestamp, and the
  regression covers that seedless interruption directly.
- The registered scenario runs its production-floor and ordering profiles in
  separate Vitest processes because hosted crypto state is process-scoped.
- Focused unit, harness, Cloudflare control, typecheck, bundle, and exact
  hosted-local scenario checks pass; commit, PR, CI, and required review gates
  remain.
Status: completed
Updated: 2026-08-04
Completed: 2026-08-04
