# Clarify auto-reply revision terminal logging

## Goal

Make local `murph run` auto-reply recovery logs distinguish a before-delivery revision from a stalled or duplicate provider turn.

Success criteria:

- Safe terminal output shows the existing revision progress detail when late same-conversation input forces a provider restart.
- Raw/private provider status details still remain hidden by default.
- Focused terminal logging tests cover the revision detail.

## Constraints

- Preserve unrelated dirty work and active ledger rows.
- Keep the change to terminal presentation; do not alter delivery, recovery, grouping, or retry behavior.
- Do not expose raw channel identifiers, delivery targets, message text, local paths, or secrets.

## Plan

1. Register this active lane in the coordination ledger.
2. Patch assistant CLI terminal logging to treat the existing revision status detail as safe-visible.
3. Add focused logging coverage.
4. Run package-local focused verification.
5. Close the plan through the repo workflow, committing only the scoped logging/test/plan files if safe.

## Verification

- PASS: `pnpm --dir packages/assistant-cli exec vitest run test/assistant-ui-logging.test.ts --config vitest.config.ts --no-coverage`
- PASS: `pnpm --dir packages/assistant-cli typecheck`
- PASS: `pnpm --dir packages/assistant-cli test`
- PASS: `pnpm --dir packages/assistant-cli test:coverage`
- PASS: `git diff --check -- packages/assistant-cli/src/run-terminal-logging.ts packages/assistant-cli/test/assistant-ui-logging.test.ts agent-docs/exec-plans/active/2026-04-25-auto-reply-revision-terminal-logging.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- PASS: security/privacy review found no identifier, path, message-text, delivery-target, or secret leakage in the safe formatter.
- PASS: coverage-write review added direct unsafe-details proof for the same revision detail and found no remaining coverage concerns.

## Notes

- The same-second `replied` then `reply-skipped` sequence is expected recovery flow: the first recovered receipt writes reply artifacts for the capture group, and the next failed receipt is immediately recognized as already covered by those artifacts.
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
