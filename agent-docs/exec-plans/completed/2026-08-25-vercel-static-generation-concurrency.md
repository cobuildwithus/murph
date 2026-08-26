# Vercel Static Generation Concurrency

Status: completed

Date: 2026-08-25

## Goal

Keep hosted Web production builds within the existing two-CPU build budget by
preventing each Next static-generation export worker from silently using its
default eight-page concurrency.

The protected invariant is that build-resource fanout stays explicit and
bounded without weakening route generation, type validation, or static output.

## Evidence And Ownership

- `apps/web/next.config.ts` is the current owner of the hosted Web production
  build shape and already sets `experimental.cpus` to `2`.
- The pinned Next 16.3 implementation defaults
  `experimental.staticGenerationMaxConcurrency` to `8` when it is unset and
  uses that value to batch concurrent export-page work.
- `apps/web/README.md` is the single prose owner for the hosted production-build
  memory contract.

No new state, queue, dependency, telemetry path, retry policy, or route-specific
behavior is needed. The smallest correction is to derive the static-generation
cap from the existing CPU-budget constant.

## Plan

1. Configure static-generation concurrency from the existing hosted Web
   production-build CPU constant.
2. Extend the focused Next-config contract test so the two settings cannot
   drift apart.
3. Record the bounded static-generation contract in the current production
   build owner documentation.
4. Run the focused config suite, hosted Web typecheck and lint, documentation
   drift/reference checks, diff checks, and privacy review.

## Failure, Rollback, And Deploy Skew

- The change affects build scheduling only; generated routes and runtime
  behavior remain unchanged.
- A lower concurrency can increase static-generation duration, so exact-head
  Vercel preview/deploy evidence remains the external acceptance boundary.
- Rollback is the ordinary removal of this config field. There is no persisted
  state, cross-plane skew, or migration.

## Verification

- Focused `apps/web/test/next-config.test.ts` proof for the exact config value
  and coupling to the existing CPU budget.
- Hosted Web typecheck and lint for the touched app configuration.
- Documentation drift/reference validation and `git diff --check`.
- Final diff review confirms no secret, identifier, generated artifact, or
  unrelated change entered the patch.

## Verification Log

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/next-config.test.ts`
  passed: 46 tests.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm --dir apps/web lint` passed with warnings only in unchanged files.
- `pnpm docs:drift` passed.
- A direct `tsx` config assertion confirmed both `experimental.cpus` and
  `experimental.staticGenerationMaxConcurrency` resolve to `2` for the
  production-build phase.
- `git diff --check` passed, and targeted privacy/domain scans found no new
  private identifier or noncanonical-domain text.
Updated: 2026-08-25
Completed: 2026-08-25
