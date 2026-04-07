# Final hosted-execution transport-only sweep

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Keep `@murphai/hosted-execution` ruthlessly transport-only by moving the last hosted-web-specific convenience out of the public package while preserving the current hosted-web public-origin fallback behavior.

## Success criteria

- `packages/hosted-execution` no longer exports or defines the Vercel-specific public-origin fallback helper.
- `apps/web` owns the `VERCEL_PROJECT_PRODUCTION_URL` fallback locally for hosted public-origin resolution.
- Shared hosted-execution env helpers remain vendor-neutral normalization helpers only.
- Focused tests cover the app-local fallback behavior and the trimmed shared package surface.

## Scope

- In scope:
- `packages/hosted-execution/src/env.ts`
- `packages/hosted-execution/src/index.ts`
- `packages/hosted-execution/test/**`
- `apps/web/src/lib/hosted-web/public-url.ts`
- `apps/web/test/public-url.test.ts`
- `packages/hosted-execution/README.md` if the package wording needs to be tightened to match the cut
- this execution plan and the coordination ledger
- Out of scope:
- changing hosted public-origin precedence or env names
- changing bearer-auth dispatch/control behavior
- broader hosted package export pruning beyond the hosted-web-specific helper

## Constraints

- Technical constraints:
- Preserve the existing `apps/web` fallback precedence: explicit hosted public-base envs first, then `HOSTED_WEB_BASE_URL`, then `VERCEL_PROJECT_PRODUCTION_URL`.
- Keep shared hosted-execution base-URL normalization behavior unchanged.
- Product/process constraints:
- Preserve unrelated dirty hosted-worktree edits.
- Re-read overlapping hosted files before editing because other hosted lanes are active.

## Risks and mitigations

1. Risk: accidentally widening the cleanup into a broader export shake-up.
   Mitigation: limit the cut to the Vercel-specific helper and leave generic transport helpers intact.
2. Risk: changing hosted-web public-origin behavior while moving ownership.
   Mitigation: port the existing fallback logic into `apps/web` with the same tests and precedence.
3. Risk: leaving stale imports or tests against the removed shared helper.
   Mitigation: remove the public export in the same change and run focused hosted-web plus package tests.

## Tasks

1. Register the lane and capture the exact ownership cut in this plan.
2. Move the Vercel-specific public-origin fallback helper into `apps/web`.
3. Trim the public hosted-execution export surface and update any affected tests/docs.
4. Run focused verification, complete the required final review audit, and finish with a scoped commit.

## Decisions

- Keep generic hosted-execution URL normalization in the public package, but keep vendor-specific env fallback logic app-local.
- Treat this as a behavior-preserving ownership cleanup, not an opportunity to change env precedence or route topology.

## Verification

- Commands to run:
- `pnpm --filter @murphai/hosted-execution test`
- `pnpm --filter @murphai/hosted-web test -- --run public-url.test.ts`
- `pnpm typecheck`
- Expected outcomes:
- The public package no longer exposes a Vercel-specific helper.
- Hosted web still resolves its public base URL with the same fallback precedence.

## Verification status

- `pnpm --filter @murphai/hosted-execution test` passed.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --project hosted-web-store-config apps/web/test/public-url.test.ts --no-coverage` passed.
- `pnpm --filter @murphai/hosted-execution typecheck` passed.
- `pnpm --dir apps/web lint` completed with pre-existing warnings only and no errors.
- `pnpm typecheck` remains blocked by unrelated existing failures in `packages/core/src/vault.ts` and `packages/assistant-engine/src/usecases/*`.
- `pnpm --dir apps/web typecheck:prepared` remains blocked by unrelated existing failures in dirty hosted-web Stripe files plus the same existing `packages/core/src/vault.ts` errors.
- `pnpm --filter @murphai/hosted-web test -- --run public-url.test.ts` was not usable as a targeted proof because the workspace wrapper still executed unrelated failing hosted-web suites; the exact-file Vitest command above was used instead.
Completed: 2026-04-07
