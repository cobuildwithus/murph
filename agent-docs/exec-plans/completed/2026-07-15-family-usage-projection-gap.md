# Keep Family usage available during billing period projection gaps

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Preserve active Family members' sponsored access and assigned-tier usage
  attribution when the local Stripe billing-period projection is temporarily
  absent or does not contain the usage timestamp.
- Replace PR #605's cross-plane attribution protocol with the smallest
  web-owned correction that matches the advisory usage contract.

## Success criteria

- Active Family membership remains the sponsorship authority while the local
  Family billing projection is absent, invalid, or its period timestamps lag.
- Usage is attributed to the member's Family tier and a UTC calendar-month
  allowance period during the projection gap; a stale personal trial is not
  used instead.
- Valid Stripe periods remain preferred; invalid or non-Family billing
  projections cannot determine the allowance period; and no schema, retry
  queue, runtime protocol, or cross-plane state is added.
- Focused regression tests and diff-aware verification pass; the required
  high-risk acceptance/review gates complete with unrelated blockers recorded.

## Scope

- In scope: Family-sponsored allowance resolution, focused hosted-web tests,
  and the durable plan-usage contract describing the fallback.
- Out of scope: historical exact-period reattribution, runtime admission,
  Cloudflare/Temporal/assistant changes, schema changes, and PR #605 cleanup.

## Constraints

- Technical constraints: reuse the allowance resolver's existing calendar
  fallback and keep Family billing validation at the web owner.
- Product/process constraints: included usage is advisory; sponsored access is
  derived from active membership/group state; preserve unrelated ledger work.

## Risks and mitigations

1. Risk: Reusing period bounds from a malformed non-Family billing projection.
   Mitigation: active membership still supplies sponsorship, but only a paid
   Family projection is eligible and the shared resolver validates its bounds.
2. Risk: Split advisory usage across a calendar fallback and a later Stripe
   period.
   Mitigation: document the bounded fallback explicitly; do not add a second
   ledger or retry state machine for a non-billing, advisory meter.

## Tasks

1. Prove PR #605's originating failure and classify its later scope growth.
2. Add focused failing regression coverage for gate and accounting behavior.
3. Reuse the existing UTC calendar-period fallback for active Family usage.
4. Update the durable usage contract and run required verification/review.

## Decisions

- Active Family membership owns sponsorship identity; local billing projection
  validity controls only whether its period bounds can be reused.
- Exact historical Stripe-period reattribution is intentionally excluded
  because this meter is advisory and the repo forbids a second usage owner.

## Verification

- Focused hosted usage Vitest passes 84/84 tests, including the accounting,
  Family-source, missing-period, and invalid-projection regressions.
- `pnpm test:diff` passes: web typecheck, dev smoke, lint (zero errors), 5,106
  tests with 139 skipped, and the production build.
- Low-concurrency `pnpm verify:acceptance` passes the changed hosted-execution
  owner (344/344 tests) and all completed guards/owners. The overall command is
  blocked outside this diff by a CLI release-tarball timeout, an
  assistant-engine worker-shutdown timeout, and an assistant-runtime
  preemption assertion.
- The required coverage-write pass added only the missing Family-source
  assertion. ReviewGPT and PR CI run against the exact pushed head.
Completed: 2026-07-15
