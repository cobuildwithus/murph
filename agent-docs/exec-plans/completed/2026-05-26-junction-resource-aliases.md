# Junction resource aliases and default coverage

Status: completed
Created: 2026-05-26
Updated: 2026-05-26

## Goal

- Fix Junction resource classification/import coverage for documented daily data resources so webhook/resource jobs and importer allowlists agree on canonical names.

## Success criteria

- `daily.data.activity/sleep/workouts/steps` still process.
- `daily.data.sleep_cycle` and `daily.data.hypnogram` normalize to a supported raw-artifact summary resource.
- `daily.data.calories_active` and `daily.data.distance` normalize to default timeseries resources.
- Inbound `heart_rate` and `body_weight` aliases normalize to `heartrate` and `weight` before device-sync resource checks and importer allowlisting.
- Focused package tests, root typecheck, and smoke checks pass or any unrelated blocker is documented.

## Scope

- In scope: Junction resource-name normalization, default summary/timeseries lists, importer metric mapping, focused regression tests.
- Out of scope: new Junction API clients, live Junction credential smoke tests, non-Junction wearable behavior, broader query ranking.

## Constraints

- Technical constraints: keep `externalRef.system = "junction"` and preserve source-provider provenance; do not widen raw payload storage or log raw health payloads.
- Product/process constraints: preserve unrelated dirty test edits in `packages/device-syncd/test/**`; use scoped code changes and the repo completion workflow.

## Risks and mitigations

1. Risk: adding defaults broadens routine Junction polling volume.
   Mitigation: only add documented resources requested here and keep `glucose` opt-in.
2. Risk: alias drift between provider jobs and importer allowlists.
   Mitigation: use one shared resource normalizer from the importer provider surface.

## Tasks

1. Add shared Junction resource-name normalization.
2. Apply it before device-sync category inference/resource allowlisting and importer allowlisting.
3. Update defaults for `sleep_cycle`, `distance`, and `calories_active`.
4. Add focused regression tests for webhook/resource jobs and importer normalization.
5. Run required verification and completion audits.

## Decisions

- Use `sleep_cycle` as the canonical summary name for both `sleep_cycle` and `hypnogram`; initial importer behavior is raw-artifact-only.
- Keep `weight` as Murph's internal timeseries resource while the Junction client continues translating outbound REST calls to `body_weight`.

## Verification

- Passed: `pnpm --dir packages/importers exec vitest run --config vitest.config.ts test/device-providers-junction.test.ts --no-coverage`.
- Passed: `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts test/junction-resource-aliases.test.ts --no-coverage`.
- Passed: `pnpm test:smoke`.
- Passed: `git diff --check`.
- Passed: diff scan for local home path and local username across this task's intended files.
- Blocked during handoff: `pnpm typecheck` failed on unrelated active edits in `apps/web/src/lib/device-sync/wake-service.ts` where the raw-health log guard found `input` logged via `console.warn`.
- Scoped commit required partial staging because `packages/device-syncd/src/providers/junction.ts` also contained unrelated overlapping diagnostics edits.
Completed: 2026-05-26
