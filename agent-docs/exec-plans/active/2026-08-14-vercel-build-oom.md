# Restore reliable Vercel production builds

Status: active
Created: 2026-08-14
Updated: 2026-08-14

## Outcome

- Restore reliable hosted Web builds on Vercel's 4-core, 8-GB Standard builder.
- Remove the current intermittent Turbopack OOM and timeout behavior without
  weakening migrations, typechecking, generated artifacts, or runtime checks.

## Evidence

- A production build on 2026-08-14 exited 137 during Turbopack compilation and
  Vercel reported a container out-of-memory event.
- Two earlier production builds reached Vercel's build-duration ceiling with
  Turbopack compilation as their last emitted phase.
- The repository's completed Standard-builder investigation already proved that
  Turbopack intermittently exceeded this machine after local graph reductions.
- The explicit Webpack build worker plus memory-optimization path passed three
  consecutive forced-cold Standard previews and a later integration preview.
- Production returned to Turbopack after one forced-cold preview, which was not
  enough to disprove the known intermittent capacity failure.
- The first restored local Webpack build completed compilation, then Next's
  generated route validation found two current `main` helpers exported from a
  route/page module. Those invalid exports must be corrected before deployment.
- After those corrections, the full build completed all routes but the final
  relocated-function probe showed that Webpack checks the inlined build-time
  source path before the deployed `apps/web` asset layout. The resolver must
  prefer the runtime layout so image routes never reach outside their function.
- Preview deployments are suppressed twice: the checked-in branch allowlist
  permits only `main`, and the Vercel project Ignored Build Step cancels every
  non-production deployment. A force-deploy commit does not override that
  command. The cold proof therefore needs both one exact task-branch allowance
  and one deployment-scoped `ignoreCommand` override; both temporary settings
  must be removed after the proof.
- The first current-scale Webpack preview restored the existing Vercel build
  cache and remained inside compilation for more than 15 minutes. The proven
  Next 16.3 Webpack lane previously compiled in 2.6 to 3.2 minutes, while Next's
  own cache guidance warns that a sufficiently large Webpack disk cache can be
  slower than rebuilding. The compiler transition therefore needs a one-time,
  fail-closed cache epoch: clear `.next/cache` until a successful Webpack build
  writes the new epoch, then retain normal warm caching on later deploys.

## Protected invariants

- Production migrations and the complete hosted Web build/check sequence remain
  unchanged.
- The 1-GiB parent and 3-GiB generated-contract TypeScript worker policy remains
  unchanged.
- The correction changes only the production compiler/resource path; local
  development remains on Turbopack and application behavior is unchanged.
- Production project settings and build-machine tier are not changed.

## Tasks

1. Restore the previously proven explicit Webpack production invocation and its
   supported build-worker/memory-optimization settings.
2. Correct the two invalid route-module exports exposed by the restored builder.
3. Make OG/card assets prefer the deployed runtime layout under Webpack.
4. Invalidate the incompatible pre-cutover build cache once, preserving warm
   Webpack caching after a successful epoch build.
5. Update focused build-policy coverage and the hosted Web build contract.
6. Run focused tests, hosted Web typechecking, and a complete local production
   build.
7. Commit and push the exact candidate, open a PR, and complete the preliminary
   specialist plus final ReviewGPT gates with exact-head CI.
8. Run a forced-cold Standard preview on the exact candidate and verify that the
   build uses Webpack and reaches Ready without an OOM.

## Deployment concerns

- This is Web-only build tooling. It has no Cloudflare or persisted-state skew
  window.
- The first production deployment after merge should be inspected for the
  explicit Webpack banner and successful completion on the Standard builder.
