# Assistant Runtime Extraction

Status: completed_with_unrelated_repo_blockers
Created: 2026-03-27
Updated: 2026-03-27

## Goal

Extract a headless `@healthybob/assistant-runtime` workspace package so hosted execution no longer imports its runtime surface from the published `healthybob` CLI package, while also removing the current Cloudflare `@ts-nocheck` seam and the container-level job serialization that exists only because hosted runs mutate global `process.env`.

## Scope

- Add a new runtime package that exposes typed hosted-runtime helpers behind an explicit runtime context/config object.
- Move `apps/cloudflare` off the direct `healthybob` hosted-runtime imports and onto the new package.
- Replace process-wide hosted env mutation with isolated per-job execution so the container HTTP bridge can accept overlapping requests safely.
- Remove the Cloudflare bridge-file typecheck exclusions that only existed for the current CLI-coupled seam.
- Keep docs and verification truthful for the new package/runtime boundary.

## Constraints

- Preserve the current canonical vault and encrypted hosted bundle model; this is a runtime-surface extraction, not a second persistence model.
- Do not revert or overwrite unrelated active assistant/Cloudflare edits already present in the worktree.
- Keep the new package headless and typed; no CLI command graph or Ink/UI logic should move into it.
- Stay honest about what remains coupled to existing assistant internals versus what is now truly isolated by explicit runtime context.

## Risks

1. The new package could become a thin rename over the existing CLI surface without actually improving runtime isolation.
   Mitigation: make the Cloudflare-facing API explicit about runtime context/env and move the env-isolation logic into the new package so the container no longer serializes jobs.
2. Worker/thread isolation for hosted jobs could break existing commit/finalize/outbox behavior.
   Mitigation: keep the orchestration contract stable and extend focused Cloudflare tests around commit ordering and overlapping runs.
3. Typecheck fallout could spread because the old bridge files were excluded.
   Mitigation: narrow the extracted public surface, type it explicitly, and only pull the Cloudflare bridge files back into no-emit typecheck once the new package compiles cleanly.

## Verification Plan

- Focused:
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --maxWorkers 1 --no-coverage apps/cloudflare/test/node-runner.test.ts apps/cloudflare/test/container-entrypoint.test.ts`
- Required repo commands after integration:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Direct scenario proof:
  - Run overlapping hosted jobs against the container bridge and verify the requests can overlap without env bleed or forced queueing.

## Outcome

- Landed `packages/assistant-runtime` as the Cloudflare-facing hosted execution surface.
- Removed the Cloudflare `@ts-nocheck` bridge and app-local typecheck exclusions for `src/node-runner.ts` / `src/container-entrypoint.ts`.
- Defaulted hosted execution to isolated child-process runs so per-user env overrides no longer require container-level serialization.
- Updated focused Cloudflare tests to prove concurrent hosted runs and concurrent commit overlap.
- Updated architecture/runtime/testing docs plus `apps/cloudflare/README.md` to reflect the new boundary.

## Verification Results

- Passed: `pnpm --dir packages/assistant-runtime typecheck`
- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --maxWorkers 1 --no-coverage apps/cloudflare/test/node-runner.test.ts apps/cloudflare/test/container-entrypoint.test.ts`
- Failed outside this lane: `pnpm --dir apps/cloudflare typecheck` and `pnpm --dir apps/cloudflare test` because of existing workspace issues in `packages/hosted-execution/src/auth.ts` (`BufferSource` typing) and `packages/runtime-state/src/device-sync.ts` (`Headers.entries` typing)
- Failed outside this lane: `pnpm typecheck` because `packages/hosted-execution` currently fails to build
- Failed outside this lane: `pnpm test` and `pnpm test:coverage` because the repo hygiene guard already rejects tracked `apps/web/postcss.config.mjs`
