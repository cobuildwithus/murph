## Goal

Land the downloaded Strava integration patch on top of the current repo state without reopening the already-landed hosted provider-config cleanup.

## Scope

- `apps/cloudflare/scripts/deploy-automation/worker-secret-names.ts`
- `apps/cloudflare/src/hosted-env-policy.ts`
- `apps/web/**` Strava device-sync copy and generic provider-label seams touched by the artifact
- `packages/device-syncd/**` Strava provider, webhook, config, and service wiring
- `packages/importers/**` Strava descriptor and importer adapter wiring
- `packages/query/**`, `packages/operator-config/**`, `packages/setup-cli/**`, `packages/contracts/**`, `packages/assistant-engine/**`, `packages/assistant-cli/**` narrow artifact-aligned follow-on updates

## Constraints

- Keep changes scoped to the downloaded artifact and current-head applicability fixes only.
- Preserve unrelated dirty-worktree edits, especially active hosted-assistant continuity work.
- Treat Strava webhook admin state as provider-owned config, not a new generic hosted persistence seam.
- Do not add dependencies.

## Verification

- `pnpm typecheck`
- Coverage-bearing scoped verification for touched owners using `pnpm test:diff <paths>` when truthful, otherwise owner coverage commands plus `pnpm test:smoke`
- Required completion-workflow audit passes: `coverage-write` on `gpt-5.4-mini`, then `task-finish-review`
- Run the generated recursive follow-up helper after the repo task is complete
Status: completed
Updated: 2026-04-17
Completed: 2026-04-17
