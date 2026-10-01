# Restore reliable Vercel Web builds after isolated-worker OOM

Status: completed
Created: 2026-08-31
Updated: 2026-08-31

## Goal

- Restore repeatable hosted Web production builds on Vercel's 8 GB Standard
  machine without weakening route generation, TypeScript validation, static
  output, or post-build trace checks.

## Success criteria

- The production Webpack compile no longer retains or writes a cache that the
  runner deletes before every build and therefore can never reuse.
- Focused runner/config/production-guard tests and the hosted Web typecheck pass.
- A production-faithful local build completes with the same runner used by
  Vercel and records a lower or safely bounded memory shape.
- Repeated exact-head Vercel Standard previews complete from the cold Webpack
  path; required PR CI and final ReviewGPT pass.

## Scope

- In scope: the hosted Web production Webpack cache policy, its runner/config
  tests, the live build-memory owner docs, and exact-head deployment proof.
- Out of scope: larger Vercel machines, weakened validation, Turbopack
  migration, product behavior, and unrelated workspace bundle reduction.

## Constraints

- Technical constraints: retain the isolated Webpack worker, 1 GiB parent / 3
  GiB worker split, two-worker static generation, and all existing checks.
- Product/process constraints: use the existing build runner/config owners,
  keep the repair deletion-first, avoid production-secret reads, and preserve
  Vercel/Cloudflare deploy compatibility.

## Risks and mitigations

1. Risk: disabling Webpack's production cache lengthens compilation.
   Mitigation: production already deletes that cache before every compile, so
   it has no cache-hit value; compare build duration with the current cold path.
2. Risk: a single passing build hides the existing intermittent cliff.
   Mitigation: require repeated exact-head Standard previews, not one pass.
3. Risk: a smaller heap or skipped check masks the problem.
   Mitigation: do not change heap limits or validation; remove only redundant
   cache work and retain focused contract tests.

## Tasks

1. Confirm adjacent Vercel successes/failures use the same memory policy and
   identify the remaining composed-memory owner.
2. Disable the production Webpack cache at the existing config boundary and
   delete the runner's now-redundant per-build cache-reset branch.
3. Update focused tests and the live production-memory documentation.
4. Run focused tests, typecheck, and a production-faithful memory build.
5. Commit, open a draft PR, run exact-head Vercel/CI/ReviewGPT gates, and verify
   repeated Standard previews before handoff.

## Decisions

- Treat the two OOMs after multiple identical-policy successes as capacity
  variance, not as a semantic regression from the intervening CLI-only change.
- Prefer disabling the no-hit production Webpack cache over lowering heap
  limits, changing machines, or adding another process supervisor.
- The paired local production lane reduced peak RSS from 5.52 GB to 3.96 GB,
  reduced compile time from 144 seconds to 117 seconds, and replaced a 2.74 GB
  Webpack cache with no Webpack cache directory.
- The exact reviewed PR head passed every required GitHub check and final
  ReviewGPT with no findings. One forced-cold Standard preview reached Ready;
  a second identical preview remained queued for 57 minutes behind
  production-priority deployments without entering a build container. The user
  explicitly authorized merge, so the prioritized post-merge production build
  owns the second live Standard proof.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/next-config.test.ts apps/web/test/production-next-build-runner.test.ts apps/web/test/production-migration-guard.test.ts`
- `pnpm --dir apps/web typecheck`
- `MURPH_HOSTED_WEB_VERIFY_LANE=build MURPH_HOSTED_WEB_BUILD_MEMORY_GUARD=0 pnpm --dir apps/web verify`
- Expected: focused contracts and typecheck pass; the full production runner
  compiles, generates every static page, and completes post-build checks.
- Result: 119 focused tests passed; hosted Web typecheck passed; the production
  lane compiled all routes, generated 284/284 static pages, passed dev smoke
  and build-output tests, and completed lint with only the 44 pre-existing
  warnings reported by the baseline lane. Required PR checks passed, final
  ReviewGPT returned `ROUND_OUTCOME: PASS`, and the first forced-cold Vercel
  Standard preview reached Ready with `webpack_cache=disabled` in its build
  policy log.
Completed: 2026-08-31
