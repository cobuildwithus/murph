# PR 548 ReviewGPT lifecycle fixes

Status: completed
Created: 2026-07-10
Updated: 2026-07-12

## Goal

Resolve the evidence-backed lifecycle findings from PR #548's first valid
ReviewGPT round while reducing the attribution implementation to one warm-slot
owner.

Success criteria:

- An AbortSignal-induced child exit is attributed to the prior turn abort,
  while a child that exits before an abort is observed remains a process exit.
- The stopped prior process remains the sole handoff source for the next cold
  start reason; no second module-global pending-reason owner remains.
- Warm reuse, teardown retry, managed-account isolation, idle compaction, and
  constructor-failure attribution retain direct regression proof.
- The final pushed head passes focused verification, required audits, a new
  ReviewGPT round, CI, and mergeability checks.

## Scope

- `packages/assistant-engine/src/assistant-codex.ts`
- `packages/assistant-engine/test/assistant-codex-runtime.test.ts`
- This plan and its coordination-ledger row.

## Constraints

- Preserve the exact child-process ownership and signal behavior.
- Keep first-writer-wins reason precedence; do not let an observed abort
  overwrite an already-recorded spontaneous exit.
- Prefer deletion over another lifecycle manager, queue, or persisted state.
- Preserve unrelated working-tree and active-plan work.

## Tasks

1. Add direct failing proof for the AbortSignal/SIGINT/close ordering.
2. Record abort attribution before the abort-induced signal can close the child.
3. Delete the pending-reason owner and derive replacement attribution from the
   stopped process retained in the existing warm slot.
4. Run focused lifecycle coverage, owner typecheck, required re-audits, parent
   final review, scoped finish commit, push, ReviewGPT, CI, and merge.

## Verification

- `assistant-codex-runtime.test.ts` focused lifecycle selectors: 3 passed,
  162 skipped, one worker.
- Hosted runtime timing/redaction selectors: 2 passed, 29 skipped, one worker.
- `packages/assistant-engine/tsconfig.typecheck.json` and
  `packages/assistant-runtime/tsconfig.typecheck.json`: passed.
- Assistant-engine owner coverage: 143 test files passed, 1 skipped; 2,045 tests
  passed, 4 skipped; 89.46% statements, 80.76% branches, 94.01% functions,
  and 89.49% lines.
- `git diff --check`: passed.
- Security/privacy re-audit: clean. Coverage-write follow-up: no edits and no
  remaining accepted or actionable proof findings; the concurrent teardown
  branch is exercised directly.
- Parent final scope/call-path review: no remaining accepted or actionable
  findings. The PR-lane ReviewGPT slot and clean-machine CI remain external
  merge-readiness gates on the stable pushed head.

## Decisions

- The first valid ReviewGPT round's abort/exit race is accepted because the
  existing production-faithful EPIPE/SIGINT regression reaches the ordering.
- The lifecycle simplification is accepted only if existing behavior tests
  prove the stopped prior process can replace the pending scalar without adding
  another owner or cleanup path.
- The local-ahead history is accepted as the one lifecycle-fix commit plus the
  previously completed ordinary `main` reconciliation; remerge inspection found
  no manual conflict-resolution delta and no unresolved GitHub review thread.
Completed: 2026-07-12
