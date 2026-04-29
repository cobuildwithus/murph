# Health Commons Projection Loader Cleanup

## Goal

Make the experiment projection data boundary simpler and more composable by moving projection path knowledge into the generated route index and replacing app-local bespoke loaders with one projection-key loader.

## Success Criteria

- Route index entries expose generated projection paths for public experiment pages.
- `packages/health-commons` stores generated projections in one projection artifact collection.
- `apps/web` uses one generic experiment projection loader keyed by projection type.
- Existing compact payload behavior and Next trace guarantees stay intact.
- Focused package/web tests, typecheck, lint, build, trace guard, and completion reviews pass.

## Constraints

- Preserve the route bundle as canonical dependency-closure data.
- Preserve unrelated dirty-tree work.
- Do not widen into biomarker page projection design in this pass.
- Do not expose local personal identifiers in files, commits, logs, or handoff.

## Working Set

- `packages/health-commons/src/web-artifacts.ts`
- `packages/health-commons/src/build.ts`
- `packages/health-commons/src/runtime.ts`
- `packages/health-commons/test/**`
- `apps/web/src/lib/health-commons/generated-experiment-artifacts.ts`
- `apps/web/src/lib/health-commons/experiment-browse.ts`
- `apps/web/src/lib/health-commons/experiment-projections.ts`
- `apps/web/app/(dashboard)/experiments/[experimentId]/research/page.tsx`
- `apps/web/test/**`
- `apps/web/scripts/check-health-commons-traces.ts`

## Verification Plan

- `pnpm --dir packages/health-commons typecheck`
- `pnpm --dir packages/health-commons test`
- `pnpm --dir packages/health-commons generate:check`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/web lint`
- focused projection Vitest suite
- `pnpm --dir apps/web build`
- scoped `git diff --check`

## State

- Started from commit `6fdf844` that landed compact experiment projections.
- Route index now carries projection paths for public experiment routes.
- Health Commons generation now writes projections from one projection artifact map.
- `apps/web` now reads experiment projections through one projection-key loader backed by route index metadata; compatibility wrappers remain for existing callers.
- Package runtime route-index validation now rejects unsafe generated-web bundle/projection paths before reading artifacts.
- Generator projection metadata and projection artifact writes now derive from one local projection spec list.
- App and package loaders now verify a projection path and loaded artifact match the route bundle's canonical route id/key before returning it.
- App and package loaders also reject top-level projection `id` mismatches where projections expose `id`.
- Focused package tests, package generate check, app lint, focused projection route tests, scoped diff check, and app build/trace guard pass.
- App `typecheck:prepared` was blocked earlier by an unrelated hosted-onboarding test fixture error (`HostedPrivyIdentity.telegram` missing); `apps/web build` later completed Next TypeScript successfully.
- The broader focused app projection suite that renders the experiment layout is blocked by an unrelated dirty `experiment-hero.tsx` change that sets both `priority` and `preload` on the same Next image.
Status: completed
Updated: 2026-04-29
Completed: 2026-04-29
