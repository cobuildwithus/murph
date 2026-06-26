# PR 295 ReviewGPT round 13 fixes

## Goal

Resolve the accepted ReviewGPT round 13 finding for hosted Retell phone calls.

Success criteria:

- Synthetic fallback accepted input id `initial` cannot authorize
  `murph.create_phone_call`.
- Explicit durable/manual accepted input can still authorize phone-call tools.
- Focused assistant verification and typecheck pass before pushing and
  rerunning ReviewGPT.

## Constraints

- Do not weaken the phone-call execution-time authority recheck.
- Do not reintroduce generic hosted request-key scope.
- Keep the fix in the phone-call-specific accepted-input filter.
- Preserve unrelated active-plan and working-tree edits.

## Approach

1. Reject fallback id `initial` in phone-call accepted input filtering.
2. Add a regression proving `source: "manual"` with id `initial` is rejected.
3. Run focused assistant tests/typecheck, commit, push, and rerun ReviewGPT.

## State

Ready for scoped commit.

## Notes

- Round 13 finding: fallback prompt item can have `source: "manual"` and
  `id: "initial"`, so rejecting only `source: "initial"` was insufficient.
- Fixed by making `id: "initial"` ineligible in the phone-call-specific
  accepted-input filter.
- Verification passed:
  `pnpm --dir packages/assistant-engine exec vitest run test/assistant-phone-calls.test.ts`;
  `pnpm --filter @murphai/assistant-engine typecheck`;
  `git diff --check`.
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
