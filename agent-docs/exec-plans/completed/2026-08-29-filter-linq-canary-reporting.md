# Exclude Linq production canary from user reporting

Status: completed
Created: 2026-08-29
Updated: 2026-08-30

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
3. Add focused ordinary-member, canary-member, unconfigured, and
   production-shaped delivery-attribution regressions.
4. Run scoped verification, review the diff and Product UX journey, then complete the PR review gates.

## Decisions

- Keep canary execution and account reset unchanged; filter only downstream reporting.
- Do not hardcode a phone number or member id.
- Preserve existing aggregate snapshots because their historical message totals no longer retain enough member attribution for a safe rewrite.
- Exclude outbound deliveries by the canary member's canonical current and
  pending Linq chat lookup keys, not by the external participant phone: delivery
  phone lookup keys identify Murph's sender line.

## Verification

- `pnpm --dir apps/web test:prepared -- test/hosted-signup-notification-email.test.ts test/hosted-onboarding-linq-production-canary-reset.test.ts test/hosted-ops-growth.test.ts` — passed, 81 tests.
- `DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-ops-growth-canary-postgres.test.ts` — passed against a freshly migrated disposable local database. Both canary cycles were excluded while ordinary traffic on the same Murph line remained counted.
- Scoped ESLint across the changed TypeScript files — passed.
- `pnpm --dir apps/web typecheck` — passed.
- Product UX replay: the configured canary still completes the unchanged messaging journey, operators no longer see its member or message activity in new snapshots and emails, ordinary members on the shared sender line remain visible, and unconfigured environments retain the prior behavior.
- ReviewGPT round 1 identified and the parent accepted the sender-line attribution defect; the correction now filters by the canonical current and pending Linq chat lookup keys.
- ReviewGPT substantive round 2 reviewed the full corrected snapshot at `2b8906a688611f7921c00640c94082db5ae01ff6` and returned `ROUND_OUTCOME: PASS`; the parent final review found no unresolved issue.
- Current-base merge-tree proof completed cleanly for the corrected candidate.
Completed: 2026-08-30
