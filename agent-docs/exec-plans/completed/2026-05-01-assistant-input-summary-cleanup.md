# Assistant Input Summary Cleanup

## Goal

Make assistant automation internals input-first by replacing inbox-shaped scan/grouping summaries with an engine-native assistant input summary type.

## Scope

- `packages/assistant-engine/src/assistant/automation/**`
- Directly coupled assistant-engine tests

## Constraints

- Preserve existing projection capture ids as optional metadata.
- Keep legacy receipt metadata readable while writing input-id metadata going forward.
- Preserve unrelated dirty work in the checkout.

## Verification

- `pnpm typecheck` passed.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-auto-reply-grouping.test.ts test/assistant-automation-support.test.ts test/assistant-automation-runtime.test.ts` passed.
- `pnpm --dir packages/assistant-engine test:coverage` passed.
- `bash scripts/workspace-verify.sh test:diff <assistant-engine automation files>` was blocked by unrelated active-plan/audit-artifact checks outside this task.

## Status

Completed. Archived without committing ledger changes because `COORDINATION_LEDGER.md` has overlapping unrelated dirty rows.
