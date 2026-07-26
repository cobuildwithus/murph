# Paid usage rowless-period cutover

Status: completed
Created: 2026-07-25
Updated: 2026-07-25

## Goal

- Preserve the legacy $10 Pulse or $25 Edge allowance for every already-open
  paid period when the 80%-of-price allowance rule deploys, including members
  whose period has not yet been materialized in `hosted_ai_usage_period`.

## Success criteria

- A predeploy data migration materializes missing current-period rows at the
  legacy limit for direct Pulse, direct Edge, Family Pulse, and Family Edge.
- The migration matches the runtime's direct-billing priority, oldest active
  Family sponsorship selection, paid billing-period validation, and UTC
  calendar-month fallback.
- Existing rows, usage spend, trials, thread containers, inactive access, and
  following-period behavior remain unchanged.
- Focused SQL and PostgreSQL proof covers all four paid cases, exclusions,
  idempotency, and the following-period boundary.
- Canonical verification passes, the remediation is committed and pushed, and
  final ReviewGPT returns zero accepted findings for the remediation delta.

## Scope

- In scope: one bounded Prisma data migration, migration-specific tests,
  migration inventory, and current paid-usage rollout documentation.
- Out of scope: new schema, runtime state owners, billing pauses, plan prices,
  discounts, trials, purchased usage credit, thread-container budgets, and
  historical-period rewrites.

## Constraints

- Keep the completed original plan immutable.
- Use `INSERT ... SELECT ... ON CONFLICT DO NOTHING`; never rewrite a row that
  already owns a period's spend or allowance.
- Interpret persisted timestamps as UTC instants, matching the application
  convention for Prisma `DateTime` and the runtime UTC-month fallback.
- Preserve direct paid access as the canonical source when direct and Family
  state overlap.

## Risks and mitigations

1. Risk: deployment creates a window where a member can receive the lower limit
   before their legacy row exists.
   Mitigation: run the data migration in the existing Vercel predeploy migration
   phase before the new application head is promoted.
2. Risk: the cutover seeds the wrong Family group or period.
   Mitigation: select the oldest active membership exactly as the runtime does
   and only trust a current paid Family billing projection; otherwise use the
   same UTC calendar month fallback.
3. Risk: the cutover overwrites current usage state.
   Mitigation: insert only absent composite keys and prove idempotency plus
   preservation of pre-existing rows.
4. Risk: old and new application writers overlap during deployment.
   Mitigation: both writers converge safely on the same composite key; old code
   can only preserve or insert the higher legacy limit, while new code preserves
   that higher same-period limit. No persistent rollout machinery is needed.

## Tasks

1. Add the bounded current-period legacy-row migration.
2. Add static and PostgreSQL migration proof for all four paid cases and
   relevant exclusions.
3. Update current rollout documentation and the migration inventory.
4. Run focused and canonical verification.
5. Close the remediation plan with a scoped commit and push the exact PR head.
6. Run final ReviewGPT on the remediation delta concurrently with CI, resolve
   any accepted findings, and confirm mergeability.

## Verification

- Migration-specific PostgreSQL proof passed under a non-UTC session timezone:
  both direct tiers and both Family tiers received their legacy open-period
  limits; direct billing won an overlapping Family sponsorship; the oldest
  active Family membership matched runtime selection; invalid, inactive,
  suspended, and thread-container cases stayed unseeded; an existing spent row
  stayed byte-for-byte unchanged; and a second migration run inserted no rows.
- Focused billing, allowance, Family, Stripe, migration, and migration-inventory
  coverage passed with 279 tests and one intentional skip.
- Hosted Web TypeScript, focused ESLint, and the production migration guard
  passed.
- Canonical `pnpm test:diff` passed in Blacksmith Testbox
  `tbx_01kydva8g29h16dbfd93jebavz`: Web build, lint, dev smoke, TypeScript, and
  6,514 tests passed with 173 skips.
- Parent final review found no remaining remediation issue. The final ReviewGPT
  remediation round runs against the closed-plan pushed head as required by the
  PR workflow.

Completed: 2026-07-25
Completed: 2026-07-25
