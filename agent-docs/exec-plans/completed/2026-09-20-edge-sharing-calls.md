# Skip current vault-share projection scopes

Status: completed
Created: 2026-09-20
Updated: 2026-09-20

## Goal

- Skip snapshot capture and delivery for vault-share scopes already published
  at the current source workspace version, retaining current consent fences.

## Success criteria

- Current scopes disappear before capture; new grants and partial pages remain
  discoverable with the full-cohort token. First-materialization, deferred work,
  revocation, source-version races, and empty snapshot clearing still pass.
- Focused tests, relevant typechecks/build, and complexity guard pass; parent
  owns final candidate review, ReviewGPT, and exact-head CI.

## Scope

- In scope: optional discovery query, existing share-version filtering, tests.
- Out of scope: delivery authority, schema changes, production deployment.

## Constraints

- Reuse persisted projection source version and the existing cohort read.
- Older Web ignores the optional query; older runtimes omit it. No new state,
  query, transaction, concurrency, or runtime effect owner is introduced.

## Risks and mitigations

1. Skipping a new or partially materialized generation could lose publication.
   Preserve all authorized ids in the token and filter only fully current scopes.
2. Discovery can race grant, revoke, and source changes.
   Preserve existing final transactional delivery fences and rerun their tests.

## Tasks

1. Thread the known workspace version through scope discovery.
2. Filter current scopes with the existing share version and add focused proof.
3. Run owner verification, review diff, close plan, commit, push a draft PR.

## Decisions

- No changelog: internal request reduction preserves all member-visible sharing
  behavior and publication authority.

## Verification

- Web: `pnpm exec vitest run --config apps/web/vitest.config.ts
  apps/web/test/projection-store.test.ts
  apps/web/test/vault-share-active-kinds-route.test.ts
  apps/web/test/vault-share-deliver-route.test.ts
  apps/web/test/vault-share-grant-store.test.ts --no-coverage`: 95 passed.
  Store-only rerun after simplifying accumulation: 30 passed.
- Cloudflare: focused `runtime-platform-vault-share-port`, `vault-share-port`,
  and `vault-share-web-control-policy` suites: 18 passed.
- Runtime: `vault-share-projection` and
  `hosted-runtime-projection-wake-convergence` suites: 156 passed.
- `pnpm --dir packages/hosted-execution build`, assistant-runtime and Cloudflare
  typechecks, and Web `typecheck:prepared`: passed. Initial Web typecheck caught
  two test-fixture type errors; fixed before the passing rerun.
- `pnpm complexity:diff`: passed, changed scope-discovery maximum stays 19.
  Existing runtime/projection/contract hotspots are unchanged; this patch only
  threads one already-owned version through their existing call boundaries.
- `pnpm docs:drift` and `git diff --check`: passed. Frog list reviewed; no new
  repository friction needed a workaround or entry.
- Local implementation and diff review complete. Parent owns final candidate
  review, external ReviewGPT, Ready transition, and required exact-head CI.
Completed: 2026-09-20
