# Frog Autofix Round 10 Authority Follow-up

## Goal

Resolve the two production-reachable findings from the valid exact-head
ReviewGPT audit while preserving the existing parent-owned authority chain and
durable GitHub handoff queue.

## Proven gaps

- The parent packages a committed Frog task path and digest, but later issue
  refreshes and finalization prove only that one binding still exists. A task
  edit, move, replacement, or deletion can therefore change the authority that
  originally admitted the candidate without preventing unattended merge.
- Missing or rejected implementation output and terminal edit-only worker
  failure can occur before any PR exists. Recovery then treats the branch as a
  fresh attempt, requests another implementation, and repeatedly selects the
  oldest issue instead of producing a durable human handoff.

## Design

- Extend the existing parent-rendered PR metadata with the exact committed task
  path and SHA-256 captured at admission. Preserve the same identity in trusted
  parent-local pre-PR provenance, require it when recovering a candidate, and
  compare it with a fresh `origin/main` read at every existing authority refresh
  through the final merge fence.
- Reuse the deterministic issue branch, fixed recovery PR body, and exact-head
  `review-findings` marker for terminal pre-PR dispositions. Publish only a
  parent-authored empty handoff commit and fixed metadata; never publish rejected
  candidate bytes or model prose. Keep infrastructure unavailability retryable.
- Add no new queue, database, scheduler, service, credential, model turn, or
  durable state owner.

## Verification

- Production-shaped focused tests for task edit, rename, deletion, replacement,
  phase/binding drift, recovery identity, and the unchanged positive path.
- Production-shaped terminal pre-PR tests for absent/rejected patch and worker
  timeout/nonzero outcomes, including next-issue advancement and transient
  failure retry behavior.
- Focused Frog suite, workspace typecheck, documentation and shell guards,
  permission/read-only smokes, privacy/diff checks, current-base merge tree,
  exact-head CI, and a later valid ReviewGPT PASS.

## Progress

- [x] Recover and validate the exact ReviewGPT findings response.
- [x] Reproduce and accept both findings against production code paths.
- [x] Implement immutable task-identity binding through merge.
- [x] Implement durable terminal pre-PR handoff.
- [x] Update focused proof and owner documentation.
- [x] Verify and prepare the scoped correction for commit and push.
- [x] Keep exact-head ReviewGPT, CI, merge, installation, and scheduled-service
  proof in the existing PR lifecycle rather than creating another state owner.
Status: completed
Updated: 2026-08-12
Completed: 2026-08-12
