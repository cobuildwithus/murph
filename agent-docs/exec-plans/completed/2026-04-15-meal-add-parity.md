# Meal Add Parity

## Goal

Align meal-add write surfaces so core, importers, vault usecases, CLI, assistant tools, and inbox promotion all support the same canonical meal fields: note/media, `occurredAt`, `source`, `ingredients`, and `nutrition`.

## Success Criteria

- `core.addMeal` persists `source`, `ingredients`, and `nutrition`.
- Structured-only meals are allowed when they include `ingredients` and/or `nutrition`.
- Importers and integrated vault services accept and forward the full canonical shape.
- Human CLI `meal add`, assistant `vault.meal.add`, and `inbox.promote.meal` expose the same persisted structure.
- Result contracts and tests reflect the widened shape.

## Constraints

- Preserve existing simple photo/audio/note meal logging.
- Keep worker ownership narrow to reduce shared-worktree conflicts.
- Do not revert unrelated in-flight edits.
- Follow the required repo verification and audit workflow before handoff.

## Worker Lanes

1. Canonical runtime lane
   - Owns `packages/core/**`, `packages/importers/**`, `packages/vault-usecases/src/usecases/{types.ts,integrated-services.ts}` and directly related tests.
   - Delivers end-to-end canonical input parity for `source`, `ingredients`, and `nutrition`.
2. Human CLI lane
   - Owns `packages/cli/**`, `packages/operator-config/src/vault-cli-contracts.ts`, and CLI tests.
   - Adds mixed-mode `meal add` support with `--input` plus existing simple flags.
3. Assistant + inbox lane
   - Owns `packages/assistant-engine/**`, `packages/inbox-services/**`, `packages/operator-config/src/inbox-cli-contracts.ts`, and related tests.
   - Exposes the widened meal-add shape to assistant/native tools and photo-backed promotion.

## Expected Verification

- `pnpm typecheck`
- Truthful scoped coverage lane via `pnpm test:diff <paths...>` if it covers the touched owners, otherwise package-local `test:coverage`
- Any direct scenario proof needed for persisted write behavior
- Required `coverage-write` audit on `gpt-5.4-mini`
- Required `task-finish-review` audit

## Notes

- The human CLI should prefer `--input @meal.json` over a large flat flag surface for structured meal data.
- `inbox.promote.meal` remains the preferred photo-backed path; it should gain structured overrides instead of forcing a separate assistant write flow.
Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
