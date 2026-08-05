# Hosted Web build critical-path optimization

Status: completed
Created: 2026-08-05
Updated: 2026-08-05

## Goal

- Shorten the hosted Web production deployment without weakening database
  migration, typechecking, generated-route validation, or build-memory safety.
- Remove only work that is proven redundant and keep TypeScript/compiler
  ownership explicit.

## Root-cause evidence

- The first Next.js 16.3 production deployment completed successfully in about
  8m18s from build start to readiness. Its restored Next 16.2 cache could not
  accelerate the version-changed compile: Webpack took 3m12s, while the prior
  warm Next 16.2 production compile took 1m32s. A prior deliberately cold
  Webpack production deployment took 8m11s overall, so the Next 16.3 result is
  consistent with a cold build rather than a new framework regression.
- Exact-commit GitHub proof measured `next build --webpack` at 269 seconds:
  2.6 minutes compiling, 56 seconds in Next's TypeScript phase, 13.3 seconds
  generating 233 static pages, and the remainder in collection/finalization.
- The preceding Next.js 16.2.6 commit took 286 seconds in the same proof lane,
  so the framework upgrade did not cause the slow Next build.
- Production currently runs Prisma generation once inside
  `release:production:migrate` and again inside `pnpm build` in the same Vercel
  checkout. The second command cost about four seconds in the observed deploy.
- After production Linq synchronization logs its completed work, the process
  waits about 30.7 seconds before the build begins. The script leaves its Prisma
  client open and the owned PostgreSQL pool has a 30-second idle timeout.
- The canonical workspace source typecheck already uses TypeScript 7. The Web
  package retains a local TypeScript 5 compatibility boundary for framework
  and tooling consumers that still depend on that compiler API or peer range.
- Production uses the Webpack fallback with two static workers and memory
  optimizations because prior exact Vercel Standard Turbopack builds were
  killed for exceeding the 4-core/8-GB machine boundary.

## Success criteria

- A production Vercel build performs Prisma client generation only once while
  non-production/local `pnpm build` remains self-contained.
- Production migrations still run before compilation and fail closed.
- The workspace TypeScript 7 source check and Next's own generated-contract
  validation both remain enabled.
- Any Webpack change is backed by cold-build timing and memory evidence on the
  current exact source; no concurrency increase or Turbopack switch ships from
  inference alone.
- Focused migration/build-command tests prevent the duplicate work from
  returning.

## Scope

- Hosted Web production build command composition.
- Focused build and migration configuration tests.
- Evidence-backed assessment of the Web TypeScript compatibility boundary and
  the current Webpack memory/performance policy.

## Constraints

- No skipped migrations, route validation, source typechecking, or production
  readiness checks.
- No dependency change unless current package metadata proves the complete
  Web toolchain supports TypeScript 7.
- No paid Vercel machine change or production deployment from this task.

## Tasks

1. [x] Prove the TypeScript, Prisma generation, and Webpack ownership paths.
2. [x] Implement the smallest safe production-only deduplication with focused
   regression coverage.
3. [x] Run focused proof, the full local Web build, and diff-aware app
   verification; compare the exact Vercel and CI timing/memory evidence.
4. [x] Complete the required local deep review, close the plan, and create one
   scoped local commit without opening or pushing a PR.

## Verification log

- Focused Vitest: `production-migration-guard.test.ts` and
  `sync-hosted-linq-lines-script.test.ts`; 45 tests passed.
- Direct ordinary-build Prisma proof generated the client; direct exact
  production-handoff proof reused it without generation.
- Root TypeScript 7 prepared typecheck passed after generating the ignored
  Health Commons catalog.
- ESLint passed with zero errors and 36 unrelated existing warnings.
- Full `pnpm --dir apps/web build` passed with Next 16.3 Webpack compilation,
  generated-contract validation, 233 static pages, and 265 trace files.
- `pnpm test:diff` for the exact changed paths passed dependency policy,
  workspace boundaries, hosted guards, TypeScript 7, 669 Vitest files / 8,932
  tests (643 files and 8,620 tests passed; the remainder were skipped), lint,
  dev smoke, and a second Next production build.
- The required local deep review found no remaining migration-ordering,
  fail-closed, Prisma-pool lifecycle, or production-handoff defects.
Completed: 2026-08-05
