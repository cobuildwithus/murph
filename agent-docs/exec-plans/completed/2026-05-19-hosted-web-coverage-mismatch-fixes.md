# Fix hosted web Clawpatch coverage mismatch findings

Status: completed
Created: 2026-05-19
Updated: 2026-05-19

## Goal

- Resolve the 10 open `apps/web` Clawpatch `test-gap` / coverage-mismatch
  findings by adding direct route/page/config regression coverage without
  changing production behavior.

## Success criteria

- All 10 targeted Clawpatch test-gap findings revalidate as fixed.
- New or updated tests exercise the actual route/page/config entrypoints named
  by the findings.
- Hosted web focused and routed verification pass.

## Scope

- In scope:
  - `apps/web` Vitest config and tests for device-sync internal routes,
    device-sync root route, Stripe cron route, pitch/biomarkers pages,
    connect-source UI mapping, and experiment share-card route.
- Out of scope:
  - Fixing non-test-gap Clawpatch findings.
  - Changing production route behavior unless a test-only seam is impossible.

## Constraints

- Technical constraints: keep worker write sets disjoint; avoid broad app
  refactors; prefer route-level tests with mocks.
- Product/process constraints: preserve unrelated dirty work; no secrets, local
  identifiers, or raw private data in tests or docs.

## Risks and mitigations

1. Risk: Tests assert implementation details instead of the public route/page
   contract.
   Mitigation: Assert HTTP status, headers, payload shape, rendered markup, or
   config discovery behavior directly.
2. Risk: Parallel workers edit overlapping test helpers or shared config.
   Mitigation: Assign five non-overlapping write scopes and integrate locally.

## Tasks

1. Add TSX discovery to standalone hosted-web Vitest config.
2. Add internal device-sync route tests for snapshot, dirty-pending, and dirty-ack.
3. Add direct route tests for root device-sync and Stripe cron.
4. Add page entrypoint coverage for pitch and biomarkers.
5. Add coverage for connect-source UI mapping and experiment share-card route.
6. Run focused tests, routed hosted-web verification, completion audits, and
   Clawpatch revalidation.

## Decisions

- Use five workers per user request, each with a disjoint write scope.

## Verification

- Passed:
  - Focused standalone Vitest for the four added route/page coverage files
    under `apps/web/vitest.config.ts` (4 files, 19 tests).
  - `pnpm typecheck`.
  - `pnpm test:diff` over the changed hosted-web config/test files.
  - Clawpatch revalidate for all 10 targeted findings; each outcome was
    `fixed`.
  - Local coverage/security/final diff review after required audit subagents
    were blocked by the Codex usage limit.
- Known caveat: Clawpatch provider-side focused Vitest attempts were blocked by
  a read-only temp-directory error before test execution, but the same focused
  tests passed locally outside the provider sandbox.
Completed: 2026-05-19
