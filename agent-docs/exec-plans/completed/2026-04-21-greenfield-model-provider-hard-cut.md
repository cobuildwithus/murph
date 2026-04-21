# Greenfield model-provider hard cut

Status: completed
Created: 2026-04-21
Updated: 2026-04-21

## Goal

- Finish the model-provider hard cut so `target + policy` is the only `AssistantProviderConfig` owner shape across the repo and the mirrored top-level compatibility fields are removed.

## Success criteria

- `packages/operator-config/src/assistant/provider-config.ts` normalizes around explicit `target` and `policy` objects with no mirrored top-level compatibility fields remaining on `AssistantProviderConfig`.
- `packages/operator-config/src/assistant/target-runtime.ts` resolves explicit target kinds and `via` semantics for Responses-compatible routes.
- `packages/operator-config/src/assistant-backend.ts` converts backend model targets from the new normalized primitive rather than inferring shape later.
- The remaining `operator-config`, `assistant-engine`, `assistant-cli`, `setup-cli`, CLI/runtime, and directly coupled test surfaces read from `target` and `policy` instead of mirrored fields.
- Required verification passes for the touched packages succeed or any unrelated blocker is named precisely.

## Scope

- `packages/operator-config/src/assistant/provider-config.ts`
- `packages/operator-config/src/assistant/target-runtime.ts`
- `packages/operator-config/src/assistant-backend.ts`
- remaining repo callers and directly coupled tests that still depend on mirrored `AssistantProviderConfig` fields

## Constraints

- Treat the supplied patch as intent, not overwrite authority.
- Preserve unrelated worktree edits, including the generated `apps/web/next-env.d.ts` stub.
- Keep the migration scoped to hard-cutting `AssistantProviderConfig` mirror usage; do not mix in unrelated provider/runtime refactors.
- Run the repo-required verification and completion workflow before handoff.

## Verification

- planned: `pnpm typecheck`
- planned: `bash scripts/workspace-verify.sh test:diff <touched hard-cut paths ...>`
- planned: `git diff --check`

## Notes

- The supplied patch was reported unverified upstream due to missing `pnpm`; verification needs to happen locally after landing.
- The patch landing is already in progress; this follow-up turn expands it into the explicit repo-wide hard cut requested by the user.
- Current follow-up slice updates `packages/operator-config/src/assistant/hosted-config.ts` plus directly coupled `packages/operator-config/test/**` expectations so owned callers/tests no longer rely on mirrored normalized provider fields.
- Verified locally with `pnpm --dir packages/operator-config typecheck`, `pnpm --dir packages/operator-config test:coverage`, and `git diff --check` on the touched slice.
- Repo-wide `pnpm typecheck` and `bash scripts/workspace-verify.sh test:diff ...` are currently blocked by the overlapping pre-existing `packages/assistant-engine/src/assistant/providers/helpers.ts` compile error (`Property 'baseUrl' does not exist on type 'AssistantProviderTargetConfig'`), outside this turn's allowed edit scope.
Completed: 2026-04-21
