# Assistant Protocol Index

## Goal

Give Murph assistant turns a tiny first-pass list of supported Health Commons experiment protocols using only route id, title, and category.

Success criteria:

- Health Commons exposes a compact generated protocol index derived from existing generated experiment artifacts.
- Assistant prompt planning can include that index when available without failing unrelated turns if generated artifacts are unavailable.
- Prompt guidance still requires `commons protocol show` before setup or creation.
- Focused tests cover the helper and prompt rendering.

## Constraints

- Keep the primitive simple: no new persisted state, no custom sorting, no new protocol taxonomy, and no full protocol details in the prompt.
- Include hidden protocols; exclude deprecated protocols.
- Preserve public Health Commons versus private vault protocol separation.
- Preserve unrelated dirty working-tree files.

## Plan

1. Add a compact index helper in Health Commons runtime.
2. Add optional assistant prompt input and rendering.
3. Resolve the index in assistant planning with soft failure.
4. Add focused tests.
5. Run scoped verification and completion workflow, then commit scoped changes.

## Verification

- `pnpm exec vitest run --config packages/health-commons/vitest.config.ts packages/health-commons/test/runtime.test.ts --no-coverage`
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/model-behavior.test.ts --no-coverage`
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-protocol-index-planning.test.ts --no-coverage`
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm --dir packages/health-commons typecheck`
- `pnpm --dir packages/assistant-engine test`
- `pnpm --dir packages/health-commons test`
- `pnpm --dir packages/health-commons build`
- `pnpm test:diff packages/health-commons/src/runtime.ts packages/health-commons/test/runtime.test.ts packages/health-commons/test/catalog.test.ts packages/assistant-engine/src/assistant/system-prompt.ts packages/assistant-engine/src/assistant/provider-turn/planning.ts packages/assistant-engine/test/model-behavior.test.ts packages/assistant-engine/test/assistant-protocol-index-planning.test.ts packages/assistant-engine/tsconfig.json packages/assistant-engine/vitest.config.ts`
- `pnpm typecheck` blocked by unrelated dirty `packages/device-syncd/src/service.ts` referencing missing `formatValidationIssueMetadata`.

## Handoff Notes

- Landed a compact generated routeId/title/category experiment protocol index for assistant first-pass recognition.
- Prompt guidance still requires `vault-cli commons protocol show <routeId> --format json` before setup and points broad/ambiguous requests at protocol exploration.
- Added planning proof that missing generated artifacts soft-fail to an empty index instead of breaking conversation turns.
- Updated stale Health Commons deterministic hash expectations exposed by the package test after the recent removal of protocol confirmation prompts.

Status: completed
Updated: 2026-05-04
Completed: 2026-05-04
