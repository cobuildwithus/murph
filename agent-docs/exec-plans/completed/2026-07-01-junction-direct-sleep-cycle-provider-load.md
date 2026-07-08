# junction-direct-sleep-cycle-provider-load

Status: completed
Created: 2026-07-01
Updated: 2026-07-01

## Goal

- Post-merge review fix from PR #353: direct `sleep_cycle` webhook imports should not depend on the Junction provider-list endpoint when the direct record carries no source-reference identity, so complete direct payloads still import when `/v2/user/providers/...` is transiently unavailable.

## Success criteria

- `shouldLoadJunctionDirectResourceSourceProviders` only returns true for `sleep_cycle` / `sleep` records that pass `hasJunctionSourceReferenceIdentity`.
- Regression test: direct sleep_cycle payload with no source-reference ids imports exactly once even when the provider-list fetch throws, and never falls back to `/v2/summary/sleep_cycle/`.
- Existing coverage that source-referenced direct records still load providers keeps passing.

## Scope

- In scope: `packages/device-syncd/src/providers/junction.ts` predicate, `packages/device-syncd/test/junction-provider.test.ts` regression test.
- Out of scope: sanitize/projection behavior, importer/core write paths, other Junction resources.

## Constraints

- Technical constraints: minimal diff; no `as any`; preserve provider resolution for records with source-reference identity.
- Product/process constraints: device sync is user-critical; do not add external failure dependencies to direct-import success paths.

## Risks and mitigations

1. Risk: a direct record with a nested source reference stops loading providers.
   Mitigation: `hasJunctionSourceReferenceIdentity` already searches nested objects/arrays; existing tests for `provider_connection_id` / `connection_id` / `source_id` records assert providers are still fetched.

## Tasks

1. Narrow the `shouldLoadJunctionDirectResourceSourceProviders` predicate so `sleep_cycle` uses the same source-reference gate as `sleep`.
2. Add regression test: no-source-reference direct payload imports while the provider-list endpoint throws.
3. Confirm existing source-referenced direct sleep_cycle tests still cover the provider-load path.

## Decisions

- Reuse the existing `sleep` gating rule instead of adding a new predicate or try/catch around the provider call: smallest change, one source of truth.

## Verification

- Commands to run: `pnpm test:diff packages/device-syncd/src/providers/junction.ts packages/device-syncd/test/junction-provider.test.ts` (fallback: `pnpm --dir packages/device-syncd test:coverage`); `pnpm typecheck` if time permits.
- Expected outcomes: device-syncd Junction provider tests pass, including the new no-source-reference regression test and the existing source-referenced provider-load tests.
Completed: 2026-07-01
