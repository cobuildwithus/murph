# PR 626 hosted checkpoint terminal-boundary proof

## Goal

Make the shutdown/checkpoint hosted-local regression recognize both durable
production cleanup boundaries without weakening exact-delivery proof.

Success criteria:

- The scenario observes a second natural idle snapshot after cold restore.
- The scenario accepts either a completed assistant cleanup pass after that
  snapshot or a quiescent no-runtime-wake snapshot with no cleanup pass.
- Both paths still require zero mailbox lag, no runtime error, exactly two
  provider requests, two exact replies, and no duplicate work during the
  stability window.
- Exact-head required CI and ReviewGPT are green before merge.

## Evidence

- One exact-head CI run reached the second natural snapshot with no runtime
  wake, left the write fence, and intentionally ran no later assistant pass.
- A later exact-head CI run reached the same snapshot and zero mailbox lag,
  then completed a no-provider assistant cleanup pass while provider cleanup
  retained the write fence.
- Both runs preserved exactly two provider requests and exactly two replies.
  Requiring only one terminal shape made the test timing-dependent even though
  the user-visible and durable invariants held in both executions.
- The revised hosted-local scenario passed in 284 seconds against the prepared
  production-style runner artifact, exercising the quiescent no-wake branch.
- Diff-aware Cloudflare verification passed 105 files and 1,819 tests, together
  with the app typecheck and repository architecture guards.

## Approach

1. Encode the two valid terminal boundaries in one named predicate.
2. Use that predicate in the wait and final assertion while retaining the
   second-snapshot, zero-lag, no-error, exact-reply, and stability assertions.
3. Run the focused hosted-local scenario, package verification, exact-head CI,
   and the active ReviewGPT gate before merge.

## Constraints

- Change only the regression; do not alter production cleanup behavior.
- Do not weaken provider-count, reply-count, mailbox-lag, durability, or
  duplicate-reply assertions.
- Preserve unrelated active-plan and working-tree changes.
- Do not expose secrets or direct personal identifiers in artifacts.

## State

Active.
Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
