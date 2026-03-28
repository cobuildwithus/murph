# Assistant Backlog Reply Fixes

## Goal

Land the reviewed unified-scanner backlog fixes so reply backlog drain preserves pending captures on other enabled channels and backlog completion never re-primes past still-pending replies.

## Scope

- `packages/cli/src/assistant/automation/scanner.ts`
- targeted `packages/cli/test/assistant-runtime.test.ts`
- coordination updates for this lane only

## Constraints

- Preserve the current unified scan design and separate routing/reply watermarks.
- Do not widen into unrelated assistant runtime, provider, or Ink chat work.
- Keep overlap-safe with active assistant automation/runtime rows in the coordination ledger.
- Add direct regression proof for the exact three-scan backlog scenario called out in review.

## Plan

1. Inspect the live scanner/test state and compare it against the reviewed patch behavior.
2. Apply the narrow backlog priming and reply-candidate filtering fixes.
3. Add or align the regression test for backlog drain, backlog clear, and subsequent newer-channel reply handling.
4. Run targeted verification plus required repo checks.
5. Run the required simplify, test-coverage-audit, and task-finish-review subagent passes before final commit.
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
