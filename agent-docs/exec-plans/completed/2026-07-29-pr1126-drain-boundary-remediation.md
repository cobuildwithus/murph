# PR #1126 source-drain boundary remediation

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Bind the sole provenance-bearing copier process to the existing
  source-write/direct-PUT drain authority.
- Make R2 inventory and canonical-owner evidence coherent while source
  publication is still active.

## Retrospective decision

- Keep strict rejection of every fresh-process destination-only object.
- Keep the live-source copier rather than switching to the frozen-source path.
- Replace rehearsal-time estimation with an exact process-bound operator signal
  after the existing production drain is proved.
- Add no durable migration state, journal, queue, lease, lock, tombstone, or
  delete capability.

## Success criteria

- Temporary zero convergence cannot terminate a production-cutover invocation
  before drain confirmation.
- After confirmation, the same invocation re-inventories and copies any delayed
  source PUT before exit.
- Owner/canonical evidence is equal before and after each inventory pair, or the
  pair is retried without losing process provenance.
- Rehearsal mode can still complete without waiting for a production drain.
- Fresh-process, crash, ambiguous-request, and destination-active paths remain
  fail-closed.

## Evidence

- A focused production-order test copies and garbage-collects A, observes
  temporary convergence, completes a delayed OC PUT of B while the exact
  process is held, then proves that process copies B only after drain
  confirmation.
- A focused owner-churn test changes canonical ownership across an inventory
  pair and proves the same invocation retries until both owner snapshots match.
- Focused online-copy tests pass 31/31, Cloudflare Node tests pass 2,162/2,162,
  Workers-runtime tests pass 3/3, and both Cloudflare and rehearsal-harness
  typechecks pass.

## Tasks

1. [x] Add the process-bound drain hold and coherent inventory/owner read.
2. [x] Add production-faithful delayed-PUT and owner-churn tests.
3. [x] Update the runbook, focused/full verification, and parent review.
4. [x] Close this plan, push, and run final ReviewGPT round 3 with the recorded
   retrospective decision.
Completed: 2026-07-29
