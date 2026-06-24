# PR 240 ReviewGPT round 27

## Goal

Fix the round 27 ReviewGPT finding that due hard-retention work can be delayed
or interrupted by foreground mailbox/default runtime processing.

Success criteria:

- Due inbox-media retention runs before mailbox lag when both are ready.
- Default processing requests do not wake or replace an active retention-only
  runtime fence.
- Focused workflow and runner-controller tests prove the ordering.
- Required verification passes before the branch is pushed.

## Constraints

- Keep the architecture simple: no new scheduler, service, persisted state, or
  retry owner.
- Preserve unrelated worktree and active-plan edits.
- Do not expose secrets, direct user identifiers, local account names, or home
  paths in committed files or handoff text.

## Approach

1. Delete the mailbox-before-retention workflow branch.
2. Make active retention-only fences non-preemptible by default requests.
3. Replace tests that encoded the unsafe behavior with retention-first tests.
4. Run focused tests, typecheck, and diff tests.

## State

Active.

## Notes

- ReviewGPT round 27 returned one high finding.
- The smallest fix is to keep hard retention as the existing bounded
  retention-only runtime path and stop default mailbox work from interrupting it.
Status: completed
Updated: 2026-06-23
Completed: 2026-06-23
