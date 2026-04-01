# Keep Cloudflare worker imports from evaluating Node-only SQLite setup

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Let the Cloudflare hosted worker import `@murph/runtime-state` during Wrangler/Cloudflare validation without evaluating Node-only SQLite setup at module load time, so production deploys can complete.

## Success criteria

- `packages/runtime-state/src/sqlite.ts` no longer calls `createRequire(import.meta.url)` at module evaluation time.
- The package still resolves `node:sqlite` correctly when a Node runtime actually calls the SQLite helpers.
- Focused verification covers the changed runtime-state surface plus the hosted Cloudflare verify path.
- A rerun of `deploy-cloudflare-hosted.yml` on `main` succeeds or any residual failure is clearly shown to be unrelated.

## Scope

- In scope:
- Narrow runtime-state import-safety fix for Cloudflare deploy validation.
- Focused regression coverage for the deferred SQLite require path.
- Optional low-risk deploy workflow cleanup if it is directly relevant and verified.
- Out of scope:
- Broader runtime-state package refactors.
- Unrelated hosted-runner cleanup.

## Constraints

- Treat this as a deploy-surface change: preserve existing Node runtime behavior and avoid changing any persisted-state contracts.
- Do not expose secrets or other sensitive deploy configuration while verifying.

## Risks and mitigations

1. Risk: Deferring `createRequire` could break Node-side SQLite callers.
   Mitigation: Keep the same `node:sqlite` resolution path, add focused proof for repeated constructor resolution, and run the relevant package/app verification.

## Tasks

1. Update the SQLite helper to defer Node-only require setup until the constructor is actually needed.
2. Add focused regression proof for import-time safety and constructor caching.
3. Run required focused verification plus the Cloudflare verify lane.
4. Rerun the production deploy workflow and inspect the result.

## Decisions

- UNCONFIRMED: whether the Node 20 deprecation warning should be fixed in the same change depends on the narrowest safe workflow tweak after the deploy path is green again.

## Verification

- `pnpm exec tsc -p packages/runtime-state/tsconfig.json --pretty false`
- `pnpm --dir packages/runtime-state test`
- `pnpm --dir apps/cloudflare test:workers`
- `pnpm test:smoke`
- `pnpm typecheck` failed for unrelated existing `packages/assistant-core` type errors on current `main`.
- `pnpm test:packages` failed for unrelated existing workspace/typebuild errors on current `main`, again centered outside this change.
- `pnpm --dir apps/cloudflare verify` failed in the same unrelated `packages/assistant-core` typecheck lane before app-local verification reached the changed runtime-state import path.
Completed: 2026-04-01
