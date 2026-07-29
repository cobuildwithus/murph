# Make usage missions composable

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Let a member pursue independent usage missions at the same time.
- Let one eligible fresh group advance both the individual-onboarding and
  active-group outcomes without permitting duplicate rewards for one policy.
- Keep mission truth in the existing hosted usage-referral owner and avoid a
  second enrollment or activation abstraction.

## Success criteria

- Different policies can be active independently while one policy cannot be
  armed twice for the same referrer and reward destination.
- Eligible unbound policies bind to a fresh group together and inbound events
  fan out to every policy attached to that group.
- Public runtime state is plural, cancellation targets an exact policy, and
  assistant guidance does not invent a one-mission replacement rule.
- Existing reward idempotency, fraud controls, provider eligibility, billing
  accounting, and product-critical messaging flows remain intact.
- Schema and migration changes are safe for the production deployment order.
- Focused verification, required product and ReviewGPT audits, exact-head CI,
  merge, deployment proof, and worktree retirement complete successfully.

## Scope

- The existing `HostedUsageReferral` indexes and production migration guard.
- Hosted usage-referral policy, binding, observation, read, and cancellation.
- Runtime-control and assistant tool wire contracts.
- Hosted low-usage mission guidance and focused regression coverage.
- The durable hosted usage-referral product specification.

## Constraints

- Treat the supplied patch as behavioral intent and preserve its wording where
  it still matches the current branch.
- Integrate with the in-flight usage-credit read model without changing that
  PR's reviewed head.
- Add no new persisted model, service, queue, dependency, or compatibility
  layer.
- Keep channel eligibility explicit: a group binds only policies supported by
  that provider.
- Preserve at-most-once reward grants and all existing abuse boundaries.

## Tasks

1. [x] Apply the supplied patch and reconcile only overlapping current-branch
   changes.
2. [x] Audit schema, migration, policy fan-out, runtime contracts, prompts,
   billing invariants, privacy, and deployment compatibility.
3. [x] Add or adjust focused proof for every changed behavior and failure
   boundary.
4. [ ] Run focused tests, typechecks, Prisma/migration checks, product review,
   and preliminary ReviewGPT.
5. [ ] Complete parent review, final ReviewGPT, exact-head CI, merge, deployment
   proof, and worktree retirement.

## Verification log

- Focused hosted-execution, assistant-engine, assistant-runtime, and Web tests:
  passed.
- Focused typechecks for hosted-execution, assistant-engine,
  assistant-runtime, and Web: passed.
- Prisma generation and schema validation: passed.
- Full migration chain against the isolated worktree database: passed.
- Installed-index proof confirms the two replacement indexes exist and the two
  restrictive indexes are absent.
- Opt-in PostgreSQL usage-credit/referral concurrency suite: passed, 17 tests.
- Product review, preliminary ReviewGPT, final review, final ReviewGPT, and CI:
  pending.
