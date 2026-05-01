# Input Projection Schema Greenfield Cleanup

## Goal

Remove the last assistant input projection retry compatibility shim so projection records are parsed by the current strict schema only.

## Constraints

- Keep projection state diagnostic/enrichment-only.
- Do not reintroduce retry cursors, retry queues, or legacy projection migration behavior.
- Preserve unrelated dirty work in the shared checkout.

## Plan

1. Delete `stripLegacyAssistantInputProjectionRetryState` and the projection schema preprocess.
2. Update direct input-store tests so legacy `nextAttemptAfter` is rejected rather than stripped.
3. Run focused assistant-engine checks, required audits, root typecheck, and scoped commit.

## Verification

- `pnpm --dir packages/assistant-engine test -- assistant-input-store.test.ts` passed after implementation and after final-review test cleanup: 84 files / 789 tests.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm --dir packages/assistant-engine test:coverage` passed.
- `pnpm typecheck` passed.
- `git diff --check -- packages/assistant-engine/src/assistant/input-store.ts packages/assistant-engine/test/assistant-input-store.test.ts agent-docs/exec-plans/active/2026-05-01-input-projection-schema-greenfield.md` passed.
- Required `security-privacy-review` passed with no findings.
- Required `coverage-write` made no changes and reported existing proof was sufficient.
- Required `task-finish-review` found one test-isolation issue; fixed by asserting update-time `nextAttemptAfter` rejection before corrupting the stored record.
- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/input-store.ts packages/assistant-engine/test/assistant-input-store.test.ts` failed in unrelated reverse-dependent CLI audit packaging because existing generated Workflow route files under `apps/web/app/.well-known/workflow/v1/**/route.js` are blocked by `pnpm no-js`.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
