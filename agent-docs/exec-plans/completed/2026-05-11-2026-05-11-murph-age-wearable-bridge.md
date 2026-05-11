# Murph Age wearable bridge feature contract

Status: completed
Created: 2026-05-11
Updated: 2026-05-11

## Goal

- Add a small, metadata-only Murph Age wearable bridge feature contract based on the R936 Pro architecture/source review.
- Keep current wearable inputs non-score-bearing while giving autoresearch and query/runtime callers a stable list of candidate wearable signal families, quality requirements, measurement windows, and unlock priorities.

## Success criteria

- `packages/health-metrics` exposes cloned wearable bridge feature specs with no score authorization and no row/value export surface.
- Tests prove the bridge specs keep activity first, require quality/provenance metadata, defer/qualify less-stable wearable signals, and cannot be mutated by callers.
- Existing Murph Age wearable context/shadow increment behavior remains non-score-bearing.

## Scope

- In scope:
  - `packages/health-metrics/src/murph-age.ts`
  - `packages/health-metrics/test/index.test.ts`
- Out of scope:
  - Changing Murph Age risk scores, coefficients, feature attributions, model promotion, product display, or recommendations.
  - Adding new datasets, local row caches, or ReviewGPT micro-gates.

## Constraints

- Technical constraints:
  - No new persisted state.
  - No participant-level values, model predictions, coefficients, or source text in repo artifacts.
  - Preserve package boundary and clone-return patterns already used in `health-metrics`.
- Product/process constraints:
  - Wearables stay context/shadow only until a future explicit model card authorizes a named metric family after calibrated hard-outcome validation.
  - ReviewGPT/Pro is used for high-value architecture/source direction only; local Codex handles this narrow contract and tests.

## Risks and mitigations

1. Risk: A bridge contract could look like a score-bearing feature list.
   Mitigation: Encode `scoreBearing: false`, `scoreContributionAuthorized: false`, and `riskEffect: "not-estimated"` on every spec and test those invariants.
2. Risk: The feature list could accidentally freeze proprietary wearable scores as first-class evidence.
   Mitigation: Put proprietary/recovery-style metrics in deferred/qualified specs only, with method/provenance notes and no score authorization.

## Tasks

1. Add the bridge feature spec types, constants, and clone helpers.
2. Add tests for source priorities, quality requirements, no-score invariants, and clone safety.
3. Run focused verification and required audits.

## Decisions

- The R936 Pro chorus consensus is to keep the lab/BP/body anchor as the only score-bearing runtime path and use wearables as a research-only residual/bridge layer until external validation.
- Top near-term data routes are partner aggregate validation, All of Us Fitbit + EHR/labs, UKB accelerometry + labs/outcomes if accessible, NSRR/MESA Sleep, WHI OPACH/WHAC, and local MIDUS/NSHAP transport work.

## Verification

- Commands to run:
  - `pnpm test:diff packages/health-metrics/src/murph-age.ts packages/health-metrics/test/index.test.ts`
  - `pnpm typecheck`
  - `pnpm test:smoke`
- Expected outcomes:
  - All commands pass, or any unrelated pre-existing failure is named with target and reason.
Completed: 2026-05-11
