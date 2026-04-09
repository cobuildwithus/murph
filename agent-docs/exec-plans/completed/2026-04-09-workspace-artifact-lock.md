# Serialize shared workspace-artifact writers in the verification harness

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Land the downloaded Pro patch intent that prevents concurrent verification runs in one checkout from clobbering shared emitted artifacts.
- Keep the fix narrow to the existing verification/build wrappers instead of redesigning the artifact layout.

## Success criteria

- Shared-artifact writer entrypoints acquire one per-worktree lock before mutating workspace outputs.
- Nested invocations do not deadlock and instead reuse the held lock via an env guard.
- The current local tweak in `scripts/workspace-verify.sh` remains intact.
- Verification docs stay truthful about the new lock behavior.

## Scope

- In scope:
  - `scripts/run-with-workspace-artifact-lock.mjs`
  - `scripts/workspace-verify.sh`
  - `scripts/build-test-runtime-prepared.mjs`
  - `apps/web/scripts/verify-fast.sh`
  - `apps/cloudflare/scripts/verify-fast.sh`
  - `agent-docs/operations/verification-and-runtime.md`
  - `agent-docs/references/testing-ci-map.md`
- Out of scope:
  - redesigning build outputs to use per-run artifact roots
  - unrelated verify-harness cleanup beyond the downloaded patch intent
  - unrelated dirty worktree files

## Current state

- The downloaded thread identifies shared mutable workspace outputs as the likely source of parallel verification collisions.
- The current branch already has an unrelated local edit in `scripts/workspace-verify.sh` that changes the default typecheck workspace concurrency.
- No local workspace-artifact lock helper exists yet.

## Plan

1. Manually land the downloaded lock helper and wrapper changes, preserving the existing local edit in `scripts/workspace-verify.sh`.
2. Apply the matching docs updates only where they remain truthful after the manual landing.
3. Run the low-risk tooling verification lane plus a focused lock smoke.
4. Run the required final review audit, then create a scoped commit.

## Risks and mitigations

1. Risk: deadlocking nested verification commands.
   Mitigation: keep the downloaded env guard pattern so child invocations inherit the held lock instead of reacquiring it.
2. Risk: removing or overwriting unrelated local harness edits.
   Mitigation: land the patch manually and preserve the existing `typecheck_workspace_concurrency_default="2"` change.
3. Risk: docs drifting from the actual behavior if the code landing changes shape.
   Mitigation: only keep the doc statements that match the final landed behavior.

## Verification

- Expected truthful lane:
  - `pnpm typecheck`
  - direct syntax checks covered by `pnpm typecheck`
  - focused workspace-lock smoke using the new helper on a pair of short-lived commands
- Completed:
  - `pnpm typecheck` passed after the initial landing and again after the review-driven fixes.
  - A focused contention smoke in the repo showed a second locked command logging that it was waiting and then completing once the holder released.
  - A temp-copy signal smoke sent `SIGTERM` to the wrapper PID, confirmed the waiter stayed blocked after that signal, and completed with `holder_status=143 waiter_status=0`.
  - A temp-copy redaction smoke confirmed the lock metadata did not contain the absolute temp-root path and stored a sanitized label instead.
Completed: 2026-04-09
