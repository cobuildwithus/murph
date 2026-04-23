# WHOOP wearable metric alignment

Status: active
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Stop WHOOP activity metrics from being silently dropped between importer normalization, canonical wearable records, and query summaries.

## Success criteria

- WHOOP `energy-burned` observations normalize into canonical `activeCalories` with a stable `kJ` to `kcal` conversion.
- WHOOP activity-only metrics that currently fall through the catalog/query seam (`max-heart-rate`, `workout-strain`, `percent-recorded`, `altitude-gain`, `altitude-change`) survive canonicalization and appear on query activity summaries.
- The shared importer/query metric mapping stays consistent for both canonical wearable records and legacy event-backed wearable reads.
- Focused importer/query tests cover the regression, the compatibility docs stay truthful, and the required verification/audit/commit flow completes or any unrelated blocker is documented.

## Scope

- In scope:
  - `packages/importers/src/device-providers/{metric-catalog,canonical-wearable-records}.ts`
  - directly coupled `packages/importers/test/**` for wearable metric normalization proof
  - `packages/query/src/{wearables.ts,wearables/{candidates,types,source-health}.ts}`
  - focused `packages/query/test/{wearables-canonical-records,wearables-normalized-surfaces,wearables-source-health-final}.test.ts`
  - `docs/device-provider-compatibility-matrix.md`
  - `agent-docs/exec-plans/active/{2026-04-23-whoop-wearable-metric-alignment.md,COORDINATION_LEDGER.md}`
- Out of scope:
  - provider transport/auth changes in `device-syncd`
  - broader wearable metric-family redesigns beyond the dropped WHOOP/Strava-compatible activity metrics
  - the active `packages/query/src/browser-replica.ts` seam split and its untracked module tree
  - unrelated hosted/cloudflare/query refactors already active in the tree

## Constraints

- Preserve the current `activeCalories` query surface instead of introducing a second calories metric for this slice.
- Keep the metric-alignment seam shared between canonical wearable records and event-backed wearable query reads so the same aliases and unit conversions do not drift.
- Work safely in the current dirty tree and avoid widening into the active `packages/query/src/browser-replica.ts` split or other hosted/runtime edits already in progress.
- Follow the plan-bearing repo workflow, including required completion audits before handoff.

## Risks and mitigations

1. Risk: Adding new wearable metric keys could widen the query surface more than intended or conflict with the active browser-replica split.
   Mitigation: Keep additions limited to the cited activity summary/source-health seams and leave the in-flight browser-replica refactor untouched in this task.
2. Risk: Converting `energy-burned` incorrectly could misstate calories.
   Mitigation: Convert only from explicit `kJ`/kilojoule-style units and round to a stable `kcal` precision in one shared mapping helper.
3. Risk: Canonical and event-backed wearable reads could still diverge.
   Mitigation: Reuse the same importer-owned metric normalization helper in both canonicalization and query observation mapping.

## Tasks

1. Register the task in the active plan and coordination ledger.
2. Extend the importer metric catalog/mapping seam for the dropped WHOOP activity metrics and the `energy-burned` unit conversion.
3. Update query activity types and metric mapping so those canonical metrics surface in summaries and generic metric reads.
4. Add focused importer/query regressions plus the truthful doc update.
5. Run scoped verification, required completion audits, and the scoped commit flow.

## Decisions

- Treat WHOOP `energy-burned` as the existing `activeCalories` summary surface, with an explicit `kJ` to `kcal` conversion, because the current product/query contract already exposes activity calories there.
- Add explicit canonical/query activity metrics for the remaining WHOOP-only fields instead of continuing to drop them.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/importers/src/device-providers/metric-catalog.ts packages/importers/src/device-providers/canonical-wearable-records.ts packages/importers/test/canonical-wearables.test.ts packages/query/src/wearables/candidates.ts packages/query/src/wearables/types.ts packages/query/src/wearables.ts packages/query/src/wearables/source-health.ts packages/query/test/wearables-canonical-records.test.ts packages/query/test/wearables-normalized-surfaces.test.ts packages/query/test/wearables-source-health-final.test.ts docs/device-provider-compatibility-matrix.md`
  - `pnpm test:smoke`
- Direct proof:
  - Run focused importer/query tests that prove WHOOP `energy-burned` survives as `activeCalories` in `kcal`, canonical-record query reads preserve the normalized metrics, and the new activity metrics reach query activity summaries/source-health reads.
- Expected outcomes:
  - Importer/query scoped verification passes.
  - WHOOP activity metrics no longer disappear at canonicalization or read time.
