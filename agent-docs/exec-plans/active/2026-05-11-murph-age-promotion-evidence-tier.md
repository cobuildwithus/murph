# Murph Age promotion evidence tier

Status: active
Created: 2026-05-11
Updated: 2026-05-11

## Goal

- Require promotion-grade validation evidence before a Murph Age model card can become product-authorized.

## Success criteria

- Product authorization requires a passed validation gate, product-promotion evidence, and at least one promotion-grade evidence tier.
- Internal-anchor and same-family sanity evidence cannot authorize product Murph Age on their own.
- Risk-to-age display authorization remains a separate product-ready gate.
- Focused tests cover current blocked cards, insufficient internal-only evidence, and a positive promotion-tier fixture.

## Scope

- In scope:
  - `packages/health-metrics/src/murph-age.ts`
  - `packages/health-metrics/test/index.test.ts`
- Out of scope:
  - Promoting any current Murph Age card.
  - Training or changing model weights.
  - Adding recommendations, protocol claims, or source-data workflows.

## Constraints

- Keep this as a health-metrics policy invariant.
- Preserve current research-mode behavior and current product-mode abstention.
- Do not introduce private health rows, identifiers, coefficients, predictions, or source bodies.

## Risks and mitigations

1. Risk: The invariant becomes too narrow for future validation paths.
   Mitigation: Use a small allowlist of promotion-grade evidence tiers that already match the research architecture: true external validation, partner aggregate validation, or Murph-native prospective validation.
2. Risk: The change silently blocks future product promotion even after evidence exists.
   Mitigation: Add a positive test fixture showing the exact evidence-tier combination that unlocks product authorization.

## Tasks

1. Add a promotion-grade evidence-tier predicate.
2. Require that predicate in effective product authorization.
3. Expand tests for internal-only denial and promotion-tier approval.
4. Run focused verification and required audits.
5. Close the plan with `scripts/finish-task` if verification is clean.

## Decisions

- `true-external-validation`, `partner-aggregate-validation`, and `murph-native-prospective-validation` are promotion-grade tiers.
- `internal-anchor` and `same-family-sanity` are useful research evidence but not product-promotion evidence.

## Verification

- Commands to run:
  - `pnpm --dir packages/health-metrics typecheck`
  - `pnpm --dir packages/health-metrics test:coverage`
  - `pnpm typecheck`
  - `pnpm test:smoke`
- Expected outcomes:
  - All commands pass or any unrelated pre-existing failures are documented with scoped evidence.
