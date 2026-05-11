# Murph Age wearable shadow summary

Status: completed
Created: 2026-05-11
Updated: 2026-05-11

## Goal

- Add a small Murph Age display-summary field that makes wearable context visible as non-score-bearing coverage/quality evidence while the research model keeps wearables out of the age score.

## Success criteria

- Murph Age display summaries report wearable context availability, feature-family coverage, quality metadata presence, and shadow-only status.
- Wearable metrics remain context-only and never appear in score-bearing feature, metric, point, attribution, or policy surfaces.
- The summary avoids row values, coefficients, recommendations, protocol claims, and product-ready age claims.
- Focused `health-metrics` tests, package coverage, typecheck, smoke, and required repo audits pass.

## Scope

- In scope:
  - `packages/health-metrics/src/murph-age.ts`
  - Focused `packages/health-metrics` tests covering the display summary.
- Out of scope:
  - Making wearables score-bearing.
  - Changing the current lab/BP/body model-card policies.
  - Adding recommendation or protocol-tracking behavior.
  - Changing query/runtime storage.

## Constraints

- Keep the implementation simple and additive.
- Preserve the ReviewGPT/Pro consensus: labs/BP/body can be score-bearing research inputs; wearables stay context/shadow until hard-outcome validation proves generalizable incremental value.
- Do not expose raw wearable values in context-only summary surfaces.
- Preserve unrelated dirty worktree edits.

## Risks and mitigations

1. Risk: A context summary could be mistaken for a score contribution.
   Mitigation: Include explicit `scoreBearing: false`, `scoreContributionAuthorized: false`, and `riskEffect: "not-estimated"` fields.
2. Risk: The summary grows into a second model.
   Mitigation: Classify quality from feature presence and coverage metadata only, not learned weights or outcomes.
3. Risk: Wearable-only inputs look product-ready.
   Mitigation: Keep display status `context-only` and product readiness false.

## Tasks

1. Add a typed wearable context summary to Murph Age display output.
2. Compute simple family/coverage/quality status from context-only feature statuses.
3. Add focused tests for strong, context-only wearable summaries and score-bearing exclusions.
4. Run required verification and audits.

## Verification

- Passed:
  - `pnpm --dir packages/health-metrics test -- test/index.test.ts`
  - `pnpm --dir packages/health-metrics test:coverage`
  - `pnpm typecheck`
  - `pnpm test:smoke`
  - `git diff --check -- packages/health-metrics/src/murph-age.ts packages/health-metrics/test/index.test.ts agent-docs/exec-plans/active/2026-05-11-murph-age-wearable-shadow-summary.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Audits:
  - `security-privacy-review`: no findings.
  - `coverage-write`: added focused wearable-only summary assertions; checks passed.
  - `task-finish-review`: no blocking findings.

## Handoff

- Ready to close. Future query/runtime surfacing should add an end-to-end check that the new wearable context summary travels through the query adapter as intended.
Completed: 2026-05-11
