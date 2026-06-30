# PR 222 Family Per-Seat Refactor

## Goal

Reshape PR 222 Family billing from a fixed `$25 / 4 seats` bundle into reserved sponsored seats:

- `$7` per sponsored person per month
- minimum 2 seats, maximum 6 seats
- owner consumes one seat
- active memberships plus pending invites must not exceed billed seats
- each sponsored member receives a member-level Pulse-equivalent usage cap

## Constraints

- Keep Family as group billing, not a direct member billing plan.
- Stripe subscription item quantity is the source of truth for paid seats; Murph mirrors it into the Family billing read model.
- Invite creation and invite acceptance must not mutate Stripe billing.
- No shared usage pool, top-ups, owner approvals, or self-paid Family hybrid in v1.
- Direct paid member billing wins during overlap until an explicit transfer flow exists.

## Plan

1. Merge latest `origin/main` into the PR worktree.
2. Update Family pricing constants, spec, schema, and migration.
3. Add Stripe subscription item and billed-seat reconciliation.
4. Replace hardcoded seat caps with billed-seat enforcement.
5. Make Family-sponsored usage explicit and aligned to Family billing periods.
6. Update settings UI/routes and focused tests.
7. Run focused tests plus workspace typecheck, then finish with a scoped commit/push.

## Verification

- Focused Family checkout, management, invite acceptance, owner snapshot, usage allowance, and account cleanup tests.
- `pnpm typecheck`.
Status: completed
Updated: 2026-06-24
Completed: 2026-06-24
