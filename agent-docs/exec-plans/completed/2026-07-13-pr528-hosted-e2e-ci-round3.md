# PR 528 hosted E2E CI repair round 3

## Goal

Make the shutdown-checkpoint conversation-ahead E2E wait for the actual
restored-cleanup completion boundary without requiring the runtime write fence
to become idle.

Success criteria:

- The scenario observes the second natural idle snapshot and the assistant
  cleanup pass that follows it.
- The scenario still proves one forced shutdown restore, two exact replies, two
  provider requests, zero mailbox lag, and no duplicate work.
- Focused typecheck and diff validation pass before push.
- ReviewGPT and CI run against the resulting exact pushed head.

## Evidence

- Exact-head CI recorded the natural idle snapshot at the configured
  180-second boundary.
- The post-checkpoint assistant cleanup pass finished seven seconds later with
  no additional provider request or reply.
- The runner remained `inFlight` because its write fence continued through a
  subsequent idle window; that state does not mean cleanup is incomplete.
- Requiring `inFlight === false` therefore waits on container lifecycle rather
  than the duplicate-replay invariant this scenario owns.

## Approach

1. Wait for exactly the next idle snapshot after the forced shutdown snapshot.
2. Require an `assistant.pass_finished` event timestamped at or after that
   natural snapshot, plus zero runtime error and mailbox lag.
3. Retain the existing exact reply/provider counts and three-second stability
   window after that cleanup boundary.
4. Run the focused typecheck and required completion audit, then commit, push,
   and run ReviewGPT concurrently with exact-head CI.

## Constraints

- Do not change production lifecycle behavior.
- Do not inject another shutdown signal or require write-fence idleness.
- Preserve unrelated active-plan and working-tree changes.
- Do not expose secrets or direct personal identifiers in artifacts.

## State

Active.
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
