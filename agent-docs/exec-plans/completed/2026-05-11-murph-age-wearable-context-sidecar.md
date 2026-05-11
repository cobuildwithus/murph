# Murph Age wearable context sidecar

Status: completed
Created: 2026-05-11
Updated: 2026-05-11

## Goal

- Let the Murph Age calculator report validated lab/BP/body scoring and available wearable context in the same calculator output without treating wearables as score-bearing.

## Success criteria

- Lab/BP/body bundles still choose score-bearing research cards exactly as before.
- Wearable metrics are exposed as a secondary context assessment when present alongside a lab/BP/body bundle.
- Wearable-only inputs remain context-only and never receive a risk or age score.
- Model-card policy still blocks wearable-sourced score-bearing features.
- Focused health-metrics and query runtime tests cover the sidecar behavior.

## Scope

- In scope:
  - `packages/health-metrics/src/murph-age.ts`
  - `packages/health-metrics/test/index.test.ts`
  - `packages/query/src/murph-age.ts`
  - `packages/query/test/murph-age-runtime.test.ts`
- Out of scope:
  - making wearable features score-bearing
  - changing the local research model card
  - product authorization or product-facing claims
  - broader source/dataset/autoresearch workflow docs

## Constraints

- Keep wearables as context-only until hard-outcome validation proves they improve calibrated prediction.
- Preserve the existing policy that lab/BP/body score-bearing metrics must come from measurement or test-result sources.
- Do not add new persisted state.
- Keep ReviewGPT out of this local plumbing slice; use it later for source/model direction and aggregate result interpretation.

## Tasks

1. Register the task in the active plan and coordination ledger.
2. Add a secondary context-assessment field to calculator output.
3. Populate the sidecar with wearable context only when it is secondary to a score-bearing bundle.
4. Add focused health-metrics and query regressions.
5. Run scoped verification, required audits, and the scoped commit path.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/health-metrics/src/murph-age.ts packages/health-metrics/test/index.test.ts packages/query/src/murph-age.ts packages/query/test/murph-age-runtime.test.ts`
- Direct proof:
  - Focused tests show lab/BP/body scoring remains ready while wearable context appears only in the secondary sidecar and never in score attribution.
Completed: 2026-05-11
