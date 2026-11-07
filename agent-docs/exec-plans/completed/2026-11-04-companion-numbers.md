# Saved companion numbers API

Status: completed
Created: 2026-11-04
Updated: 2026-11-04

## Goal and scope

Serve the private native You tab's four numeric histories from the saved Browser
Vault replica through a bounded GET. Work stays on the companion-numbers branch;
the parent owns push, PR, ReviewGPT, CI and merge. No runtime or production work.

## Design and product proof

- Reuse bearer authentication, Browser Vault access/consent, native-session
  revalidation after decryption, and the saved loader. Select core, metricsIndex,
  and deduplicated buckets for the four canonical keys at both load boundaries.
- Use the canonical zone already carried by core's meals metadata. Missing zone
  is unavailable, with no machine/UTC fallback or new projection generation.
- Return 90 local dates ending today, one saved daily value per date, dated latest,
  catalog staleness, and first/last seven-day comparisons. Daily metrics require
  four dates; VO2 uses its catalog median and two-date minimum. Normalize before
  arithmetic and round only wire values. Expose no provenance or other core data.
- Prove fresh/stale, absent and incomplete saved replicas, empty/sparse metrics,
  cloud-provider VO2, local day/DST bounds, and auth/session/consent loss. Validate
  response field allowlisting and no wake with route tests and existing loaders.

## Verification and completion

Run focused companion/loader tests, Web typecheck, changed-file lint, complexity
review and diff/privacy inspection. Document the route in the existing iOS Meals
spec, then close this plan with a scoped commit. The parent owns native rendering
and release notes for the complete You-tab feature.

## Results

Implemented the route, one companion adapter, focused route tests and the private
numbers section of the existing iOS Meals spec; the index points to that contract.

Verified locally:

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/device-sync-companion-numbers-route.test.ts apps/web/test/device-sync-companion-journal-route.test.ts apps/web/test/device-sync-companion-meals-route.test.ts apps/web/test/browser-vault-loader.test.ts apps/web/test/browser-vault-authority.test.ts` — 5 files, 86 tests passed (20 new Numbers cases).
- `pnpm --dir apps/web typecheck` — passed.
- `pnpm --dir apps/web exec oxlint app/api/device-sync/companion/numbers/route.ts src/lib/device-sync/companion-numbers.ts test/device-sync-companion-numbers-route.test.ts` — passed.
- `pnpm complexity:diff` — passed; maximum complexity 15, no hotspots.
- `git diff --check` and scoped privacy/cast inspection — passed.

Initial validation corrected an unsupported comparator check, a test array typing
error and stale-fixture expectations. The root Oxlint invocation was unavailable;
the app-local command above is the successful lint lane. A frozen-lockfile install
prepared this fresh checkout; Frog then listed existing entries successfully. No
new repository friction entry was needed.

Compatibility clarification: canonical timezone is only exposed in the saved
core through optional meals metadata (`packages/query/src/browser-replica/shared.ts:254`;
`packages/query/src/browser-replica/meals.ts:16`). Old replicas without that field
return retryable 503 instead of inventing a local day. No generation or producer
change was made. VO2 retains the requested seven-day endpoint bounds, with its
catalog median/two-date minimum rather than the daily four-date rule.

Self-review confirmed bounded selection at both loader boundaries, live authority
rechecks, no runtime entrypoint, explicit field allowlisting and correct privacy
on errors. Route fixtures mock the external decrypt boundary; the existing loader
suite supplies decoder validation. No production or native-app run was performed.
Push, PR, ReviewGPT, broad CI, native integration and release notes remain with the
parent session.
Completed: 2026-11-04
