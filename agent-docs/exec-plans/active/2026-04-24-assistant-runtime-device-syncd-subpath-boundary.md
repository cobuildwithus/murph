# Switch assistant-runtime off the `@murphai/device-syncd` root barrel

Status: in_progress
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Eliminate assistant-runtime root imports from `@murphai/device-syncd` so the hosted device-sync slice depends only on explicit public subpaths.
- Keep the current dirty-tree hosted device-sync runtime/store-helper work intact while making the minimum public-surface adjustment needed for `@murphai/device-syncd/service`.

## Why

- The workspace boundary guard treats sibling package roots as behavior-oriented contracts; this slice should not rely on the broad daemon root barrel when `service`, `crypto`, `types`, and `hosted-runtime` subpaths already exist.
- The live tree already carries hosted-runtime helper changes that removed direct `service.store` reach-throughs. This fix should layer on top of that work instead of reverting or re-shaping it.

## Scope

- `packages/assistant-runtime/src/device-sync-service.ts`
- `packages/assistant-runtime/src/hosted-device-sync-runtime.ts`
- `packages/assistant-runtime/test/device-sync-service.test.ts`
- `packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts`
- `packages/device-syncd/src/service.ts` only if a minimal re-export is required for the `./service` public surface
- `agent-docs/exec-plans/active/{2026-04-24-assistant-runtime-device-syncd-subpath-boundary.md,COORDINATION_LEDGER.md}`

## Out of scope

- changing hosted device-sync behavior, fences, or wake-hint parsing
- widening `@murphai/device-syncd` root exports or reshaping unrelated package entrypoints
- touching existing dirty WHOOP, lease-fence, or hosted-runtime hardening work beyond the minimum needed subpath surface

## Constraints

- Preserve all unrelated working-tree edits.
- Keep any `packages/device-syncd/src/service.ts` change additive and minimal because an active lease-fence lane already overlaps that file.
- Do not create commits for this task.

## Tasks

1. Register the lane and inspect the live assistant-runtime/device-syncd import surface.
2. Move assistant-runtime runtime/test imports from `@murphai/device-syncd` to explicit subpaths.
3. Expose any missing `@murphai/device-syncd/service` export needed to keep assistant-runtime off the root barrel.
4. Run the narrowest truthful verification for the touched slice and record results.

## Verification

- `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/device-sync-service.ts packages/assistant-runtime/src/hosted-device-sync-runtime.ts packages/assistant-runtime/test/device-sync-service.test.ts packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts packages/device-syncd/src/service.ts`
- `pnpm --dir packages/assistant-runtime exec vitest run test/device-sync-service.test.ts test/hosted-device-sync-runtime.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir packages/device-syncd typecheck`

## Current results

- Pending implementation.
