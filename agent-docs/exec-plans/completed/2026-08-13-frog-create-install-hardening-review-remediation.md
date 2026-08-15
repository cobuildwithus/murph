# Remediate worktree create and install review findings

Status: completed
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Close the accepted review findings for issues #1660 and #1741 without widening
  worktree lifecycle ownership.

## Success criteria

- A checked-in exact pre-lock installer fixture proves mixed-version contention.
- The pre-lock installer's final current-primary guard check uses the bounded
  compatibility wait, without representing its earlier writes as serialized.
- Hook include publication is one atomic replace-or-append mutation and retains
  the last known-good include across every injected mutation failure.
- `create-worktree` owns an admin marker until its bounded clean postcondition
  succeeds, and Frog refuses reset/clean while that marker exists.
- Focused shell/TypeScript tests, typecheck, docs checks, diff review, and privacy
  scan pass.

## Scope

- In scope: worktree create/install/guard scripts, Frog destructive-recovery
  gates, exact fixtures, focused tests, and operator documentation.
- Out of scope: a general worktree lifecycle protocol, cleanup of unrelated
  checkouts, process termination, pushing, or opening a pull request.

## Constraints

- Technical constraints: preserve Linux `flock` and macOS `lockf` behavior; use
  the existing 180-second installer bound; fail closed with generic diagnostics.
- Product/process constraints: preserve all unrelated shared checkout state and
  commit only if the repository storage guard permits it naturally.

## Risks and mitigations

1. Risk: compatibility waiting could imply historical writes were protected.
   Mitigation: limit the wait to the old no-argument final guard invocation and
   document/test that boundary explicitly.
2. Risk: failed creation could be mistaken for a recoverable dirty checkout.
   Mitigation: use one create-owned admin marker that Frog checks before any
   destructive recovery command.

## Tasks

1. Completed: add the exact predecessor fixture and bounded final-guard
   compatibility path.
2. Completed: replace the include unset/add pair and fault-inject every install
   mutation.
3. Completed: add and enforce the creation-incomplete marker in create and Frog
   recovery.
4. Completed: update documentation and run all focused verification.

## Decisions

- Reuse the installer timeout of 180 seconds for the rollout compatibility path.
- Keep the marker in the Git worktree administrative directory so failed or
  partially materialized worktrees remain fail-closed without polluting content.
- Keep the implementation complexity bounded to one marker and one shared Frog
  assertion. No general lifecycle state machine or retry queue was introduced.

## Verification

- `bash -n scripts/create-worktree scripts/install-git-hooks
  scripts/worktree-storage-guard
  scripts/fixtures/worktree-storage-guard/install-git-hooks-pre-lock`: passed.
- Exact fixture comparison with the activation base revision: byte-identical.
- Storage-guard Vitest: complete 39-test run passed before the final bounded
  failure case was added; the final six-test touched selection passed, covering
  that new case and all remediation paths. The resulting file has 40 tests.
- Frog Vitest: focused creation-marker/recovery and terminal-handoff selections
  passed. A full 50-test run completed 47 tests and reported three timing/process
  cleanup failures under host load; two Git-fixture cases pass when focused, and
  the remaining leader-first process-group case is outside this task's changes.
- `node scripts/run-typescript.mjs package -p tsconfig.tools.json --pretty
  false`: passed.
- `pnpm docs:drift` and `pnpm docs:gardening`: passed with zero findings.
- `git diff --check` and the task-diff direct-identifier privacy scan: passed.
Completed: 2026-08-13
