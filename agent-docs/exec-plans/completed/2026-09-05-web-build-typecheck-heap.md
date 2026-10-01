# Complete Web Build Typechecking With Sufficient Heap

## Outcome And Boundary

Let the production Web build complete its cold route-aware TypeScript 5 check
without depending on warmed incremental artifacts. Preserve the separate check,
its fail-closed prepared-build flag, and the existing compiler/worker limits.

## Evidence And Smallest Change

Acceptance exhausted the fixed 3584 MiB typecheck heap. A cold check using
6144 MiB with incremental caching disabled passed and reported 4161683 KiB of
compiler memory. Existing Frog entry
`20260904193709-production-next-typescript` records the same boundary failure.
Increase only the dedicated typecheck limit to 6144 MiB and align its direct
runner tests and owning docs. No dependency or product behavior changes.

## Steps And Proof

1. Update the runner, its focused tests, and build/verification references.
2. Run shell syntax, focused runner tests, and the canonical production build.
3. Review the diff and archive this plan with the scoped commit.

The enclosing push task also retries the acceptance timeouts in isolation and
preserves the already-passing Web source typecheck, tests, lint, and smoke proof.

## Results

- Increased only the TypeScript check heap to 6144 MiB. The fail-closed check,
  1024 MiB Next parent, and 3072 MiB Webpack worker remain intact.
- Shell syntax and both production runner tests passed.
- `MURPH_HOSTED_WEB_VERIFY_LANE=build MURPH_HOSTED_WEB_VERIFY_SKIP_TYPECHECK=1
  pnpm --dir apps/web verify` passed: cold production build, 715 static pages,
  development smoke, 14 build-output assertions, and lint (warnings only).
  The source TypeScript 7 check was already green in the acceptance run; this
  build reran the distinct route-aware TypeScript 5 check.
- The original Web errors were stale local dependencies and an ignored type
  file for a deleted route. Frozen installation restored the locked Privy
  version; route type regeneration and the full workspace typecheck passed.
- The composed acceptance run reported a wizard input race, three test/hook
  timeouts, and the Web heap failure. The wizard test now waits for rendered
  selection and passes with its package typecheck. The unchanged release
  tarball, maximum-cardinality device-sync, and two Health Commons files passed
  isolated retries within their original deadlines. Cloudflare Workers and all
  three built package-boundary checks passed separately.
- Parent readback and `git diff --check` passed. The change adds no source
  control flow, runtime state, dependency, or member-visible behavior; no public
  changelog is needed. Local build proof does not claim a hosted Vercel peak
  measurement.
Status: completed
Updated: 2026-09-05
Completed: 2026-09-05
