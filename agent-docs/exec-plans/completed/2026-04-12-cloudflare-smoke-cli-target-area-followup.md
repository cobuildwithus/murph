# Cloudflare Smoke CLI Target-Area Follow-up

## Goal

Land the remaining safe changes from the supplied target-area follow-up patches in the Cloudflare deploy/smoke helpers and the assistant CLI execution adapter, keeping behavior stable while tightening integer parsing and launcher env handling.

## Why

- The current target seam already includes the earlier simplification and review fixes, but it still duplicates strict integer parsing in two Cloudflare scripts.
- The assistant CLI child env still loses Windows `Path` casing during allowlist copying and executable lookup.

## Scope

- `apps/cloudflare/scripts/{deploy-automation/shared.ts,deploy-worker-version.shared.ts,smoke-hosted-deploy.shared.ts}`
- focused Cloudflare regression tests under `apps/cloudflare/test/**`
- `packages/assistant-engine/src/assistant-cli-tools/execution-adapters.ts`
- focused assistant-engine env tests under `packages/assistant-engine/test/**`
- coordination docs for this lane only

## Constraints

- Preserve unrelated in-flight assistant, Cloudflare runtime, and hosted-web edits already present in the tree.
- Treat the supplied patch files as intent, not overwrite authority; adapt them to current `HEAD`.
- Keep the change scoped to this target area and avoid reopening broader architecture work already tracked in neighboring active lanes.
- Do not expose personal identifiers from local paths, usernames, or legal names in repo files, commits, or handoff text.

## Verification

- Run `pnpm typecheck`.
- Run a truthful scoped test lane for the touched owners, preferring `pnpm test:diff apps/cloudflare packages/assistant-engine` if it stays within this slice.
- Add direct focused tests for any merged behavior that is not already covered.
- Record any unrelated blockers exactly if they appear.

## Result

Status: completed
Updated: 2026-04-12
Verification:
- `pnpm typecheck` attempted but blocked behind an unrelated in-flight `apps/web verify` workspace lock, so this lane used scoped owner checks.
- `pnpm test:diff apps/cloudflare packages/assistant-engine` failed in unrelated reverse-dependent `packages/cli` typecheck files from the active assistant target refactor; the touched Cloudflare and assistant-engine owners were not the cause.
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-cli-process-env.test.ts test/execution-adapters.test.ts --no-coverage`
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm --dir /Users/willhay/startup1/murph exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/deploy-preflight.test.ts apps/cloudflare/test/deploy-worker-version.test.ts apps/cloudflare/test/smoke-hosted-deploy.test.ts --no-coverage`
- direct proof: `pnpm --dir packages/assistant-engine exec tsx <<'EOF' ... EOF` confirmed a Windows-style `Path` input is normalized into `PATH` and the mixed-case key is removed.
Completed: 2026-04-12
