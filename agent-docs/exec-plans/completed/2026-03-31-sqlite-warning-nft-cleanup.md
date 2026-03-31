# Properly lazy-load sqlite, narrow inboxd hosted imports, and split local-web vault wrapper helpers

Status: completed
Created: 2026-03-31
Updated: 2026-03-31

## Goal

- Remove avoidable verification/build warning noise by fixing the ownership seams that eagerly load `node:sqlite`, pull iMessage code into hosted routes, and mix local-web route helpers with wrapper-only filesystem/config logic.

## Success criteria

- App and package entrypoints no longer trigger `SQLite is an experimental feature` just by importing shared modules; sqlite loads only when sqlite-backed runtime helpers are actually used.
- Hosted Linq code imports a narrow `@murph/inboxd` public surface that does not drag iMessage connector code into Turbopack/NFT traces.
- Local-web route code no longer shares wrapper-only vault/config filesystem helpers that cause whole-project NFT tracing.
- Required verification runs are recorded, and any remaining failures are clearly unrelated.

## Scope

- In scope:
  - `packages/runtime-state` sqlite helper loading
  - `packages/query` sqlite search loading and export shape
  - `packages/inboxd` public export surface for hosted Linq consumers
  - hosted Linq caller updates
  - `packages/local-web` vault helper split and any direct caller updates
  - focused tests/docs needed to keep the new seams covered
- Out of scope:
  - unrelated release-manifest and health-tail failures already present in the dirty tree
  - broad gateway-core refactor work already in flight
  - generic warning filtering for unrelated third-party source-map noise unless directly caused by these seams

## Constraints

- Technical constraints:
  - Preserve public package imports through declared entrypoints only.
  - Do not reintroduce custom Turbopack loader rewriting or package-internal sibling imports.
  - Preserve current behavior while changing import timing and package topology.
- Product/process constraints:
  - Preserve unrelated dirty-tree edits.
  - Run required verification unless blocked by credibly unrelated existing failures.
  - Audit subagents are repo-required, but this session cannot delegate without explicit user approval; call that out at handoff if unchanged.

## Risks and mitigations

1. Risk: Lazy-loading sqlite changes runtime behavior or error timing for query/runtime helpers.
   Mitigation: Keep public APIs stable, add/update focused tests, and run built-app verification that exercises the affected code paths.
2. Risk: New inboxd subpath exports drift from package shape expectations.
   Mitigation: Update package exports deliberately and run package-shape plus hosted build verification.
3. Risk: Local-web helper split changes vault path resolution behavior.
   Mitigation: Preserve existing route-facing API signatures where possible and run local-web verify plus focused tests if needed.

## Tasks

1. Lazy-load `node:sqlite` through owner helpers instead of eager module imports.
2. Add a narrow `@murph/inboxd` public subpath for Linq webhook helpers and switch hosted callers to it.
3. Split local-web vault route helpers from wrapper/config filesystem helpers and update Next wrapper/callers.
4. Run focused and required verification, then close the plan with a scoped commit.

## Decisions

- Keep the fix structural rather than expanding stderr warning filters.
- Add narrow `@murph/inboxd/linq` and `@murph/inboxd/telegram` public entrypoints instead of keeping hosted callers on the root inboxd barrel.
- Split local-web vault helpers into route-safe env/path helpers, operator-config resolution, and wrapper-only launch helpers so route code does not statically pull wrapper/config filesystem logic.
- Stop this lane at the now-narrower hosted `@murph/device-syncd` NFT seam and the remaining local-web `vault-config.ts` trace rather than widening scope into another package boundary.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - focused package/app tests covering query/inboxd/local-web as needed
  - `pnpm --dir packages/local-web verify`
  - `pnpm --dir apps/web build`
  - repo-required `pnpm test` and `pnpm test:coverage`
- Expected outcomes:
  - sqlite warning spam disappears from app build/verify flows touched by this change
  - hosted/local-web NFT warning count materially drops or is eliminated for the fixed import paths
  - any remaining repo failures are clearly unrelated to this lane
- Outcomes:
  - `pnpm typecheck` passed.
  - `pnpm exec vitest run --config packages/local-web/vitest.config.ts packages/local-web/test/overview.test.ts --no-coverage` passed.
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/linq-control-plane.test.ts apps/web/test/linq-webhook-route.test.ts --no-coverage` passed.
  - `pnpm --dir packages/inboxd exec vitest run --config vitest.config.ts test/subpath-warning.test.ts test/linq-connector.test.ts test/idempotency-rebuild.test.ts test/inboxd.test.ts --no-coverage` passed.
  - `pnpm --dir packages/query exec vitest run --config vitest.config.ts test/import-warning.test.ts test/query.test.ts --no-coverage` passed.
  - `pnpm --dir packages/cli exec vitest run --config vitest.config.ts test/search-runtime.test.ts --no-coverage` passed.
  - `pnpm --dir packages/local-web verify` no longer emitted sqlite experimental warnings, but still reported two Turbopack/NFT warnings rooted in `packages/local-web/src/lib/vault-config.ts`.
  - `pnpm --dir apps/web build` no longer emitted sqlite experimental warnings, but still reported Turbopack/NFT warnings now rooted in the hosted `@murph/device-syncd` import chain.
  - `pnpm test` failed for a credibly unrelated existing `packages/contracts/scripts/verify.ts` TypeScript/module-resolution issue (`Cannot find module '@murph/contracts'` plus implicit-any errors).
  - `pnpm test:coverage` failed for a credibly unrelated existing `build:test-runtime:prepared completed without producing the expected runtime artifacts` issue.
  - Audit subagents were not run because this session did not include explicit delegation approval.
Completed: 2026-03-31
