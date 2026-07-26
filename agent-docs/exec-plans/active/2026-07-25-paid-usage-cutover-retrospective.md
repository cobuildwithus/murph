# Paid usage cutover retrospective

Status: active
Created: 2026-07-25
Updated: 2026-07-25

## Goal

- Resolve the repeated ReviewGPT period-identity finding without adding a new
  allowance lifecycle owner.
- Preserve the legacy limit only for authoritative paid billing periods already
  open when the 80%-of-price rule deploys.

## Retrospective decision

- Original requirement: replace fixed $10/$25 included usage with 80% of the
  catalog price for direct and Family paid plans.
- First-reviewed shape: runtime-derived 80% limits plus same-key preservation of
  persisted legacy periods.
- Review-driven growth: a data migration and PostgreSQL proof attempted to seed
  rowless periods, including mutable UTC calendar fallbacks.
- Repeated mechanism: grandfathering depended on a period key that could change
  when a delayed billing projection replaced the calendar fallback.
- Decision: shrink the migration to authoritative, current paid billing bounds.
  Do not seed calendar fallbacks. This preserves all currently exposed paid
  beneficiaries, based on aggregate read-only production proof, while renewals
  and unresolved future billing projections use the requested price-derived
  policy without another compatibility owner.

## Success criteria

- Direct and Family candidates are seeded only when their current paid billing
  bounds are valid and contain migration time.
- Invalid, absent, unpaid, or non-current billing projections are skipped.
- Existing rows and spend remain untouched.
- Focused PostgreSQL proof covers both tiers and both billing modes, skipped
  fallback candidates, existing-row preservation, and same-period idempotency.
- The PR body records the retrospective, current production exposure, and the
  narrowed rollout contract.
- Canonical verification and a later ReviewGPT correction round pass.

## Scope

- In scope: the paid-usage cutover migration, its tests and inventory, current
  rollout docs, and PR evidence.
- Out of scope: new schema, timestamps, policy versions, period rekeying,
  reconciliation services, or changes to Stripe projection ownership.

## Tasks

1. Remove calendar-fallback materialization from direct and Family migration
   candidates.
2. Update PostgreSQL proof and current docs for the authoritative-period rule.
3. Run focused, canonical, and parent verification.
4. Close the plan, push the exact head, and run ReviewGPT correction round 3.

## Verification

- Aggregate read-only production proof found no active paid beneficiary on a
  calendar fallback and no overlapping non-exact legacy row. Every current
  beneficiary had authoritative paid bounds; the two rowless periods both had
  stable direct billing keys.
- Real-PostgreSQL migration and inventory proof passed 7 tests under a non-UTC
  session timezone.
- Focused billing, allowance, Family, Stripe, and migration proof passed 280
  tests.
- The production migration guard passed 36 tests and focused ESLint passed.
- Canonical `pnpm test:diff` passed locally: Web TypeScript, 6,556 tests with
  173 intentional skips, lint with zero errors, dev smoke, and the production
  Next.js build.
