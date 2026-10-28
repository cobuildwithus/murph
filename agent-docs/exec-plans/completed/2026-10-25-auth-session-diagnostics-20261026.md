# Auth session failure attribution

## Outcome

Distinguish the finite underlying failure category when the pinned authentication
library replaces a session lookup exception with a generic internal error.
Preserve session authority, public errors, privacy, and successful reads.

## Evidence and boundaries

- Source inspection shows the session endpoint logs the underlying error before
  replacing it, while the hosted authentication owner disables library logging.
- Retained production observations show generic native-session failures. They do
  not identify the underlying cause; a synthetic reproduction must establish the
  observation gap without claiming that its injected cause occurred in production.
- Existing route diagnostics remain useful but cannot recover a cause discarded
  inside the library. Avoid enabling unrestricted library logs.
- No changes to authentication policy, credentials, stored records, dependencies,
  retry behavior, or responses are authorized by this diagnostic correction.

## Plan

1. Prove the masking mechanism through the actual pinned library and hosted owner.
2. Request the smallest session-scoped, finite diagnostic patch from ReviewGPT.
3. Review privacy, volume, exact failure preservation, and success behavior; run
   focused regression tests, Web typecheck, and complexity checks.
4. Complete exact-head review and required CI, then merge and verify the actual
   production deployment through the canonical Web release path.
5. Observe retained production evidence without treating absent traffic as proof
   of recovery. Record the native-heartbeat capability boundary if still absent.

## Status

- Isolated checkout created from current main; existing PR paths and unrelated
  primary-checkout edits inspected. No concrete ownership collision identified.
- ReviewGPT authored the session-only logger hook, finite classifier, regression
  suite and README contract. The parent inspected the complete patch.
- The initial real-owner reproduction passed and demonstrated the missing cause.
  Thirty-five authored regression cases then failed only at the missing log
  assertion on the old implementation; five preservation cases passed.
- The parent corrected one test expectation after proving that the pinned
  instrumentation coerces a null-prototype rejection to a TypeError before the
  observation point. Production code was not changed for that fixture.
- All 78 focused tests now pass. Native/browser reads and renewal, exact library
  masking, APIError passthrough, post-library failures, private fields, code
  getters, malformed values and a throwing console sink are covered.
- Web typecheck, diff whitespace and privacy checks pass. Complexity debt remains
  zero, with maximum changed-source complexity increasing from 10 to 17.
- Implementation and local proof are complete. Exact-head final ReviewGPT, CI,
  merge, serving revision and production observation remain external gates.

## Verification

Under Node 24.22.1:

- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/better-auth-session.test.ts apps/web/test/better-auth-transport.test.ts apps/web/test/better-auth-request-boundaries.test.ts apps/web/test/better-auth-reconciliation-logging.test.ts --no-coverage`: 78 passed.
- `pnpm --dir apps/web typecheck`: passed.
- `pnpm complexity:diff`: passed, no hotspot above 20.
- Parent candidate review: no authentication, database, response or dependency
  policy changes; at most one finite console record per matching library catch.
  No added awaited work or success-path logs.
Status: completed
Updated: 2026-10-25
Completed: 2026-10-25
