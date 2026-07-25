# Contact-card projection-only backup number

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Preserve the member-specific Murph vCard's backup number while removing
  provider reconciliation and line-pool writes from the download request path.

## Success criteria

- `GET /api/murph-contact-card` builds the vCard from the authenticated
  member's resolved line plus one healthy alternate line already present in
  `HostedLinqLine`.
- The request path performs no Linq provider listing or reconciliation writes.
- A missing, corrupt, or unavailable alternate-line projection omits only the
  optional backup number and still returns the member's contact card.
- Focused coverage and canonical diff-aware verification pass.

## Scope

- In scope: the hosted Linq contact-card alternate-line read boundary, its
  route consumer, focused tests, and current contact-card product documentation.
- Out of scope: the scheduled contact-card reconciler, provider line/card
  setup, home-line selection, vCard avatar behavior, contact-card sharing, and
  any new persisted state.

## Constraints

- Keep the scheduled reconciler as the only live provider-refresh owner.
- Read the existing encrypted `HostedLinqLine` projection through its owning
  store boundary; do not duplicate crypto or line-health policy.
- Preserve privacy, authenticated route ownership, and the current
  backup-number label and fail-soft behavior.
- Add no dependency, service, state owner, queue, or compatibility path.

## Tasks

1. Trace the route, backup selector, provider reconciler, and projection owner.
2. Replace request-path reconciliation with one bounded projection read.
3. Add regressions for projection-only selection, no provider/write fanout,
   deterministic alternate choice, and fail-soft omission.
4. Update the current product spec if it otherwise implies live provider work.
5. Run focused and canonical verification, inspect the final diff, close the
   plan, commit, push, and open the scoped PR.

## Decisions

- The persisted line projection is fresh enough for this optional vCard field;
  scheduled reconciliation owns convergence, while download availability wins
  over a live provider dependency.
- Reuse the existing bounded `listHostedLinqContactCardLines` owner read rather
  than introducing a route-specific query or moving health policy.

## Evidence

- Before the change, the backup selector called the reconciler's line-listing
  helper. That helper first ran `syncHostedLinqPhoneNumberInventory`, which
  performs live Linq inventory work and projects every result before reading
  the same `HostedLinqLine` rows.
- The contact-card download and group-share callers need only one optional
  alternate phone number; neither needs live provider convergence to build the
  primary vCard.

## Verification

- Focused Vitest: `hosted-onboarding-linq-contact-card.test.ts` and
  `murph-contact-card-route.test.ts` passed, 24 tests total.
- Canonical `pnpm test:diff` for the production helper, focused test, and
  product spec passed: hosted-web TypeScript 7 check, 494 test files with
  6,216 passing tests and 154 skipped tests, lint with zero errors, development
  smoke, and production build.
- Direct call-path proof: the backup selector makes one bounded projection
  owner call, never invokes the inventory synchronizer or Linq fetch, skips
  projected `AT_RISK` and `CRITICAL` alternates, and returns `null` on projection
  failure so the primary vCard remains available.
Completed: 2026-07-22
Completed: 2026-07-22
