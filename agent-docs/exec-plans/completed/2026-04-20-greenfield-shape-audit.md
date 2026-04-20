# Greenfield shape audit for cron, hosted-run, Cloudflare, and Vitest seams

Status: completed
Created: 2026-04-20
Updated: 2026-04-20

## Goal

- Verify the six requested cleanup candidates against the current workspace and land only the still-missing simplifications so the repo reflects the narrowest current greenfield shape.

## Success criteria

- Each requested candidate is classified as already landed, not yet landed but safely fixed here, or deferred with a concrete blocker tied to the current dirty tree.
- Remaining changes stay behavior-preserving and narrow: no-op cron branches are removed, hosted-run acquire response shaping is centralized, write-side hosted-run row typing is explicit, repeated quarantine/control-flow paths are consolidated, shared serialized lock code is deduplicated, and package Vitest boilerplate is reduced only if the abstraction stays obviously better than the status quo.
- Overlapping dirty-tree work in `apps/web/src/lib/hosted-run/store.ts` and `apps/cloudflare/src/user-runner.ts` is preserved.

## Scope

- `packages/assistant-engine/src/assistant/cron.ts`
- `apps/web/src/lib/hosted-run/store.ts`
- directly coupled `apps/web/test/hosted-run-store.test.ts` only if required
- `apps/cloudflare/src/{user-runner,gateway-projection-cache}.ts`
- directly coupled `apps/cloudflare/test/**` only if required
- `packages/*/vitest.config.ts`
- `config/workspace-source-resolution.ts`
- a new shared helper under `config/**` only if that abstraction is justified and keeps package configs smaller/clearer

## Constraints

- Confirm current workspace state before editing because the target files already had overlapping in-flight changes.
- Keep behavior unchanged except where the requested simplification makes existing behavior more explicit.
- Do not widen the Vitest abstraction if the shared helper would create a less legible config surface than the current package-local files.
- Preserve unrelated dirty-tree edits and any rows already active in the coordination ledger.

## Verification

- passed: `pnpm typecheck`
- failed for unrelated pre-existing package issue: `pnpm test:diff apps/web/src/lib/hosted-run/store.ts config/vitest-package.ts packages/health-commons/vitest.config.ts`
  - untouched `packages/health-commons/src/index.ts` already had duplicate export `parseCliOptions`
- passed: `pnpm --dir apps/web typecheck:prepared`
- passed: `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --no-coverage ./test/hosted-run-store.test.ts`
- passed: `pnpm --dir packages/health-commons exec vitest run --config vitest.config.ts --no-coverage ./test/load.test.ts`
- passed: `pnpm exec vitest run --config packages/health-commons/vitest.config.ts --no-coverage packages/health-commons/test/load.test.ts`
- passed: `git diff --check -- apps/web/src/lib/hosted-run/store.ts config/vitest-package.ts packages/health-commons/vitest.config.ts`

## Outcome

- Already landed in the current workspace:
  - `packages/assistant-engine/src/assistant/cron.ts` already had the direct canonical `timeZone` usage and direct success status assignment.
  - `apps/web/src/lib/hosted-run/store.ts` already had the shared `buildHostedRunAcquireResponseTx(...)` helper and acquire-branch routing in the current dirty tree.
  - `apps/cloudflare/src/user-runner.ts` already used `quarantineHostedRunWake(...)`.
  - `apps/cloudflare/src/{gateway-projection-cache,user-runner,serialized-lock}.ts` already used the shared serialized lock helper.
- Newly landed locally in this lane:
  - `apps/web/src/lib/hosted-run/store.ts` now uses the explicit Prisma `HostedRun` row type for `HostedRunRow`.
  - `config/vitest-package.ts` now supports `rootRelativePath`.
  - `packages/health-commons/vitest.config.ts` now uses the shared package Vitest helper.

## Notes

- The user explicitly requested `gpt-5.4` high subagents to verify what was already landed before local fixes.
- The final review found only low follow-up suggestions. The only remaining low proof gap is extra acquire-response shape coverage in `apps/web/test/hosted-run-store.test.ts`, but the shared acquire helper was already present in the overlapping dirty workspace rather than introduced by this lane.
