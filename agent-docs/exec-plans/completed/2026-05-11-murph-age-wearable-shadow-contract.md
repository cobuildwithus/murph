# Murph Age Wearable Shadow Contract

Status: completed
Created: 2026-05-11
Updated: 2026-05-11

## Goal

- Turn the latest Pro/ReviewGPT lab-plus-wearable architecture consensus into a small runtime contract in `@murphai/health-metrics`.
- Make wearable activity, sleep, resting-heart-rate, and HRV inputs explicitly available as research/shadow increment families without authorizing them to affect the score-bearing Murph Age estimate.

## Success Criteria

- The health-metrics package exposes a versioned wearable shadow-increment policy surface.
- Shadow policies identify the allowed wearable metric groups and compatible frozen lab anchors.
- Shadow policies make score contribution, product use, and risk-effect estimation explicitly false or not estimated.
- Tests prove adding wearable context to a lab/BP/body bundle does not change the lab model's score-bearing output.
- Required health-metrics verification and completion audits pass.

## Scope

- In scope:
  - `packages/health-metrics/src/murph-age.ts`
  - `packages/health-metrics/test/index.test.ts`
  - This plan and the coordination ledger row.
- Out of scope:
  - Training or promoting a wearable model.
  - Product-facing biological-age claims.
  - Dataset ingestion, benchmark execution, or source-rights changes.
  - ReviewGPT bureaucracy for local checklist work.

## Constraints

- Wearables remain context-only or shadow-only until externally validated and separately promoted.
- Existing lab9/lab5 model-card policies remain the only score-bearing Murph Age cards.
- No row values, user identifiers, source text, predictions, coefficients, or model internals should be introduced by this contract.
- Keep the architecture simple and composable so later autoresearch can test one wearable family at a time.

## Tasks

1. Register the active work in the coordination ledger.
2. Add the versioned wearable shadow-increment policy contract.
3. Add tests for policy clone safety and lab-score invariance with wearable context.
4. Run package verification, typecheck, smoke checks, and required audits.
5. Close the plan with `scripts/finish-task`.

## Verification

- Passed: `pnpm --dir packages/health-metrics test -- test/index.test.ts`
- Passed: `pnpm --dir packages/health-metrics test:coverage`
- Passed: `pnpm typecheck`
- Passed: `pnpm test:smoke`
- Passed: scoped `git diff --check`

## Audit Notes

- Security/privacy review: no findings.
- Coverage-write pass: added Lab5 wearable-invariance proof, then reran coverage and typecheck successfully.
- Final task review: no findings; residual risk is that downstream export/display wiring will need separate review when the static shadow policy contract is consumed.
Completed: 2026-05-11
Completed: 2026-05-11
