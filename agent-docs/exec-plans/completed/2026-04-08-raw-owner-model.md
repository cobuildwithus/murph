# 2026-04-08 Raw Owner Model

## Goal

- Land the returned owner-scoped raw asset refactor cleanly in the live repo.
- Replace category-driven raw path resolution with explicit raw-asset owners and keep the change scoped to the returned patch intent.
- Rewire current raw-manifest writers, workout CSV import, validation, and focused docs/tests without disturbing unrelated `assistant-engine` worktree edits.

## Scope

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `ARCHITECTURE.md`
- `docs/architecture.md`
- `packages/contracts/src/{constants.ts,zod.ts}`
- `packages/core/src/{constants.ts,raw.ts,event-attachments.ts,mutations.ts,vault.ts,index.ts}`
- `packages/core/src/{assessment/storage.ts,domains/events.ts,operations/raw-manifests.ts}`
- `packages/core/test/{core.test.ts,raw-owner-model.test.ts}`
- `packages/assistant-engine/src/usecases/workout-import.ts`
- `packages/vault-usecases/src/usecases/workout-import.ts`
- `packages/cli/test/{cli-expansion-document-meal.test.ts,cli-expansion-export-intake.test.ts}`

## Constraints

- Treat `output-packages/chatgpt-watch/.../raw-owner-model.patch` as behavioral intent, not blind overwrite authority.
- Keep the change limited to owner-scoped raw storage and the related manifest/workout-import seams.
- Preserve the pre-existing dirty worktree edits in `packages/assistant-engine/src/assistant/automation/run-loop.ts` and `packages/assistant-engine/src/assistant/provider-turn-runner.ts`.
- Run the repo-required verification for this surface and report unrelated blockers separately if they appear.

## Plan

1. Register the task in the coordination ledger and map the returned patch onto the live raw/manifests/workout-import code.
2. Implement the owner-scoped raw asset model in contracts/core, then rewire current manifest writers and validation while preserving the inbox attachment-recovery exception.
3. Update the workout CSV import path(s) to use the shared manifest path/owner contract across the current split package layout, and refresh the focused regression/CLI compatibility tests and doc notes from the returned patch.
4. Run required verification, complete the mandatory final review, fix any findings, and finish with a scoped commit.

## Verification

- Passed: `pnpm exec vitest run packages/core/test/raw-owner-model.test.ts packages/core/test/device-import.test.ts packages/core/test/core.test.ts packages/importers/test/importers.test.ts --no-coverage`
- Passed: `pnpm typecheck`
- Passed: `pnpm test:smoke`
- Failed for unrelated pre-existing workspace split/refactor issues: `pnpm test:packages`
  - `packages/assistant-engine/test/workout-facade-primitives.test.ts`: missing `packages/assistant-engine/src/usecases/workout.js`
  - `packages/cli/test/assistant-core-facades.test.ts`: expected `@murphai/vault-usecases` export `./vault-services` is absent

## Notes

- The returned patch currently applies cleanly with `git apply --check`, but it is still being reviewed as a manual merge because the user flagged recent `assistant-engine` reshaping.
- Legacy `murph.raw-import-manifest.v1` compatibility is preserved in-memory via owner inference from `rawDirectory`; vault validation and read paths now route through that compatibility parser.
Status: completed
Updated: 2026-04-08
Completed: 2026-04-08
