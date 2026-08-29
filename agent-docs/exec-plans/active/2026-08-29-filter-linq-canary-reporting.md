# Exclude Linq production canary from user reporting

Status: active
Created: 2026-08-29
Updated: 2026-08-29

## Goal

- Exclude the configured Linq production-canary identity from internal new-user email notifications and operator growth reporting without changing the canary journey or ordinary member activation.

## Success criteria

- The production canary no longer triggers the internal signup notification email.
- The production canary is excluded from new-user and activation counts shown by the growth reporting owner.
- New daily growth snapshots omit member-linked inbound messages and Linq deliveries attributable to the configured canary.
- Ordinary Linq and non-Linq members remain included.
- Focused tests and the hosted Web typecheck pass.

## Scope

- In scope: canary identity derivation, signup-notification admission, growth-report queries, focused regression tests, and directly affected documentation if the durable contract changes.
- Out of scope: changing the canary prompts, reset lifecycle, production configuration values, ordinary activation, billing, or messaging behavior.

## Constraints

- Technical constraints: reuse the existing configured canary phone identity and its blind-index boundary; do not add persisted state, schema, dependencies, or plaintext identity comparisons.
- Product/process constraints: treat this as an internal Product UX patch, preserve private production evidence, and keep the canary fully representative of the real production journey apart from reporting.

## Risks and mitigations

1. Risk: filtering only one query leaves other growth aggregates or the email path counting the canary.
   Mitigation: trace both owners and centralize the narrow exclusion input where they already share identity primitives.
2. Risk: a missing canary configuration accidentally excludes real members or breaks reporting.
   Mitigation: make the exclusion optional and preserve current behavior when configuration is absent.

## Tasks

1. Trace signup-notification and growth-report ownership plus the existing canary identity boundary.
2. Implement the smallest optional exclusion in both reporting paths.
3. Add focused ordinary-member, canary-member, and unconfigured regressions.
4. Run scoped verification, review the diff and Product UX journey, then complete the PR review gates.

## Decisions

- Keep canary execution and account reset unchanged; filter only downstream reporting.
- Do not hardcode a phone number or member id.
- Preserve existing aggregate snapshots because their historical message totals no longer retain enough member attribution for a safe rewrite.

## Verification

- Commands to run: focused hosted-onboarding signup-notification and growth-metrics tests, then the hosted Web typecheck.
- Expected outcomes: canary fixtures produce no internal new-user email/count contribution while ordinary members retain existing results.
