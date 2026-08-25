# Generated Delivery Cleanup And Retiring Runner Wake Recovery

Status: active
Updated: 2026-08-24

## Goal

Restore the existing hosted reply-latency promise by making generated-delivery
cleanup diagnosable and convergent, and by making a wake rejected by a retiring
runner explicit and promptly retryable without abandoning its dirty checkpoint.

## Evidence

- Anonymous production timing shows a foreground message waited behind an
  oversized idle-shutdown checkpoint and subsequent cold replacement.
- Snapshot diagnostics repeatedly report generated-delivery pruning failure
  while old export artifacts remain in runtime-owned staging.
- The durable runtime log records only a failure boolean, so the exact cleanup
  invariant violation cannot currently be distinguished without private
  workspace inspection.
- Normal idle checkpoint construction is foreground-interruptible before
  canonical publication, while a last-chance shutdown checkpoint must preserve
  dirty local state and rejects new local wakes.

## Product UX Patch

- Outcome: A private message is retried promptly when it reaches a retiring
  runner, and completed generated files stop inflating later cold starts.
- Reaches: Existing hosted private-message journeys that overlap idle shutdown
  or restore a workspace with generated-delivery residue.
- Proof: A production-shaped local hosted scenario holds shutdown publication,
  appends a conversation message, preserves checkpoint durability, reports
  typed redacted cleanup diagnostics, prunes unrelated completed files, and
  restores the message for exactly one reply. Focused boundary tests prove the
  retiring-container reason and one-second retry.

## Constraints

- Preserve the canonical-publication boundary: once publication begins, the
  checkpoint completes and foreground work runs immediately afterward.
- Preserve active generated deliveries and fail closed when outbox evidence is
  missing, conflicting, or untrusted.
- Keep diagnostics metadata-only and bounded; never log paths, filenames,
  message content, hashes, or private identifiers.
- Reuse the existing foreground notification, checkpoint abort signal,
  generated-delivery cleanup owner, and local hosted E2E harness. Add no queue,
  scheduler, lifecycle owner, or persisted duplicate state.

## Plan

1. Reproduce deterministic generated-delivery cleanup failure with synthetic
   runtime state and identify the exact invariant that prevents pruning.
2. Reproduce a foreground wake arriving during snapshot archive construction
   through the production-shaped local hosted path.
3. Add a closed typed cleanup failure code plus bounded staging counts to the
   existing checkpoint diagnostics.
4. Correct the cleanup invariant at its existing owner and distinguish a
   retiring-container rejection so its existing owner retries after one second.
5. Prove cleanup success, fail-closed malformed-state behavior,
   pre-publication interruption, post-publication completion, cold restore,
   and final provider delivery.
6. Run focused tests, package typechecks, local hosted E2E proof, exact-head
   review gates, and required CI.

## Verification

- Generated-delivery residue unit coverage passes, including missing active
  staging, missing root, and malformed hard-link cases.
- Hosted snapshot bridge coverage passes with bounded cleanup diagnostics.
- Cloudflare container, runner boundary, and retry-response coverage passes.
- The hosted-local shutdown checkpoint conversation-ahead E2E passes with
  residue cleanup, one committed shutdown snapshot, cold restore, and one reply.

## Product UX Walkthrough

- Person and path: An existing hosted member sends a private message while the
  prior runner is publishing its last dirty shutdown checkpoint. The message
  stays durably queued, replacement processing resumes after publication, and
  the member receives one reply on the same route.
- Recovery state: A workspace containing completed generated-delivery files and
  one already-missing active file still removes the unrelated files, reports the
  missing reference without private metadata, and remains restorable.
- Evidence: The production-shaped hosted-local scenario exercises the real Web,
  Temporal signal, Cloudflare container, v2 checkpoint, cold restore, provider
  stub, and Linq stub through the final exactly-once send boundary.
- Difference from the initial plan: Last-chance SIGTERM checkpoint construction
  remains non-interruptible because it can contain dirty state with no other
  durable owner. The member-facing delay is reduced through safe cleanup and a
  one-second replacement recheck; ordinary idle checkpoints retain their
  existing prepublication foreground interruption.
- Verdict: Ready.
