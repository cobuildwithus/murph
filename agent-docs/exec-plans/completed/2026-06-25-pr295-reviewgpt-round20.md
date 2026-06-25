# PR 295 ReviewGPT round 20 fixes

## Goal

Resolve the accepted ReviewGPT round 20 finding that the phone-call dynamic tool
is unreachable from the current approved hosted/manual path.

Success criteria:

- Hosted/manual phone-call-capable turns provide a real non-synthetic accepted
  input id to the phone-call approval gate.
- Automation triggers and the synthetic `initial` fallback remain blocked.
- Focused assistant-engine tests pass before pushing and rerunning ReviewGPT.

## Constraints

- Do not weaken the phone-call approval gate.
- Do not let the model supply idempotency or approval ids.
- Keep the fix in the existing accepted-turn-input plumbing; do not add a new
  approval subsystem.
- Preserve unrelated active-plan and working-tree edits.

## Approach

1. Trace how manual hosted turns build `acceptedTurnInput.initialInputs`.
2. Materialize the user-approved manual input as a real accepted input item for
   the phone-call-capable hosted/manual surface.
3. Add/adjust a focused regression proving synthetic `initial` is blocked but a
   real manual accepted input exposes `murph.create_phone_call`.
4. Run focused verification, commit, push, and rerun ReviewGPT.

## State

Ready to finish.

## Notes

- Round 20 finding: missing accepted-turn inputs cause the service to synthesize
  id `initial`/source `manual`; the phone-call gate correctly rejects it, making
  the tool absent in the intended manual path.
- Implemented a hosted/manual-only accepted input id for phone-call-capable turns:
  `manual-phone-call:<turnId>`.
- Focused verification passed:
  `pnpm exec vitest run packages/assistant-engine/test/assistant-phone-calls.test.ts packages/assistant-engine/test/assistant-local-service-runtime.test.ts --no-coverage`.
- Focused typecheck passed:
  `pnpm --filter @murphai/assistant-engine typecheck`.
- Whitespace check passed: `git diff --check`.
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
