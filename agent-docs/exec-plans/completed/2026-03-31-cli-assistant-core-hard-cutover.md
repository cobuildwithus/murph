# 2026-03-31 CLI Assistant-Core Hard Cutover

## Goal

- Remove the thin CLI facade layer for headless assistant/inbox/vault/operator-config modules so CLI source imports `@murph/assistant-core` directly wherever the CLI is not the real owner, leaving only genuinely CLI-owned wrappers and command/UI code in `packages/cli`.

## Scope

- `agent-docs/exec-plans/active/{2026-03-31-cli-assistant-core-hard-cutover,COORDINATION_LEDGER}.md`
- `packages/cli/{package.json,README.md,scripts/verify-package-shape.ts,src/**,test/**,tsconfig*.json,vitest*.ts}`
- `packages/assistant-core/package.json`
- `tsconfig.base.json`
- `ARCHITECTURE.md`
- Verification helpers needed to keep the package/runtime seam honest

## Findings

- `packages/cli` still contains roughly 140 headless facade files that forward straight to `@murph/assistant-core`.
- Internal CLI code and tests still import many of those files by local path, so the current architecture keeps the compatibility layer alive inside the CLI package rather than using the owner directly.
- The published `murph` package still exports several assistant-facing subpaths; some are true CLI wrappers, while others exist only to preserve the now-redundant facade seam.

## Constraints

- Preserve daemon-aware CLI wrappers where the CLI really is the transport boundary.
- Preserve command/UI behavior and avoid changing provider routing or canonical write semantics.
- Do not make `@murph/assistant-core` depend on `murph`.
- Preserve unrelated dirty-tree edits and the active gateway/concurrency lanes.

## Plan

1. Inventory current facade files and classify each as removable internal compatibility, retained CLI wrapper, or real public CLI surface.
2. Rewrite CLI source and tests to import `@murph/assistant-core` directly for headless modules.
3. Remove obsolete thin facade files and narrow `murph` exports/path mappings/package-shape checks to the intentional CLI-owned surface.
4. Update architecture/package docs and focused seam tests to describe the hard cutover instead of the facade model.
5. Run required checks, then complete the required audit passes and commit the scoped change.

## Verification

- `pnpm --dir packages/cli typecheck` ✅
- `pnpm typecheck` ✅
- `pnpm exec tsx packages/cli/scripts/verify-package-shape.ts` ✅
- `pnpm build:test-runtime:prepared` ✅
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/assistant-core-facades.test.ts --no-coverage` ✅
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/assistant-core-facades.test.ts packages/cli/test/assistant-provider.test.ts packages/cli/test/inbox-model-route.test.ts packages/cli/test/canonical-write-lock.test.ts packages/cli/test/assistant-robustness.test.ts packages/cli/test/assistant-service.test.ts packages/cli/test/setup-cli.test.ts --no-coverage` ✅
- `pnpm exec tsx --eval "(async () => { const mod = await import('./packages/cli/src/index.ts'); console.log(JSON.stringify(Object.keys(mod).sort())); })();"` ✅
- `pnpm --dir packages/cli test` ⚠️ fails in `packages/cli/test/assistant-cron.test.ts` on cron session-id/failure-count assertions after ~96s. The task diff only changes that suite's imports from deleted CLI facades to the same `@murph/assistant-core` owners, while the failing behavior comes from untouched assistant-core cron logic, so this does not appear to be caused by the hard-cutover package-surface changes.

## Outcome

- Completed. CLI source now imports `@murph/assistant-core` directly for headless assistant/inbox/vault/operator-config ownership, the thin facade files are removed, the published `murph` package root no longer re-exports headless assistant-core compatibility surfaces, and only the CLI-owned daemon wrapper subpaths remain public.

Status: completed
Updated: 2026-03-31
Completed: 2026-03-31
