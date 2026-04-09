# Incur Canonical Alignment

## Goal

Remove Murph's custom post-processing on top of Incur's generated config schema so the published CLI package uses raw Incur generation and only exposes Incur-native schema behavior.

## Scope

- `packages/cli/scripts/{incur-config-schema.ts,generate-incur-config-schema.ts,verify-package-shape.ts}`
- `packages/cli/config.schema.json`
- `packages/cli/test/incur-smoke.test.ts`
- `packages/cli/README.md`

## Constraints

- Preserve the runtime command graph and generated `src/incur.generated.ts`.
- Keep `config.schema.json` shipped for editor validation/autocomplete, but make it match direct Incur output.
- Do not add a Murph-specific replacement metadata format.
- Preserve unrelated dirty worktree edits outside this lane.

## Plan

1. Replace custom config-schema enrichment with direct Incur artifact generation.
2. Update tests and docs so they describe only Incur-native schema guarantees.
3. Regenerate the shipped schema artifact and run truthful verification.
4. Run required review passes and commit only the scoped files.

## Verification

- `pnpm typecheck` ✅
- `pnpm --dir packages/cli verify:package-shape` ✅
- `pnpm --dir ../.. exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/incur-smoke.test.ts --no-coverage` ✅
- `pnpm test:diff packages/cli packages/assistant-cli packages/operator-config` ❌
  - CLI-targeted verification passed, including `packages/cli` package-shape verification, CLI workspace Vitest, and `packages/assistant-cli` typecheck/test coverage.
  - The lane still fails only in unrelated pre-existing dirty `packages/assistant-engine/test/assistant-automation-runtime.test.ts` assertions outside this task scope.

## Audit

- GPT-5.4 high coverage/proof pass: no findings; current package-shape guard plus focused `incur-smoke` proof were sufficient and no extra test churn was justified.
- GPT-5.4 high final review pass: no scoped findings; residual risk is limited to unexercised packed-artifact/editor-integration proof, which is already strongly covered by static package-shape checks.
Status: completed
Updated: 2026-04-09
Completed: 2026-04-09
