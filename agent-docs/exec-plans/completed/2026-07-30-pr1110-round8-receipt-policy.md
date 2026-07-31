# PR #1110 round 8 receipt policy correction

Status: completed
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Keep a multi-part Linq group delivery out of direct-message missing-receipt
  warnings even when a failed child receipt is superseded by a newer delivered
  receipt.

## Success criteria

- The existing delivery owner persists the route directness used to decide
  whether receipts are expected.
- Parent recomputation derives every nonterminal status from that durable fact,
  including failed-to-newer-delivered receipt corrections.
- PostgreSQL proof covers both group and direct two-part deliveries, the latency
  warning count, and final all-parts-delivered convergence.
- Focused tests, relevant typechecks, exact-head CI, ReviewGPT, and the final PR
  head preflight pass.

## Scope

- In scope: the Hosted Linq delivery schema/migration, acceptance persistence,
  multi-part parent recomputation, focused regression tests, and the matching
  deliverability invariant.
- Out of scope: a new receipt lifecycle, queue, reconciliation loop, or changes
  to Linq provider behavior.

## Constraints

- Technical constraints: preserve rolling-deploy compatibility with writers
  that predate the new nullable field; direct-message receipt warnings must
  remain intact.
- Product/process constraints: keep one existing delivery owner and follow the
  PR ReviewGPT remediation loop on the exact pushed head.

## Risks and mitigations

1. Risk: Existing group deliveries have no persisted directness field.
   Mitigation: when the field is null, capture the legacy no-receipt status
   before applying the next child transition, then persist the derived fact.
2. Risk: A broad status exception could hide real direct-message incidents.
   Mitigation: prove a direct two-part delivery returns to ordinary `accepted`
   and remains counted while its sibling is awaiting a receipt.

## Tasks

1. Add a nullable route-directness field and migration to the existing delivery
   owner.
2. Persist directness at runtime acceptance and derive nonterminal aggregate
   status from it, with a legacy-row fallback.
3. Add PostgreSQL-backed failed/delivered correction sequences for group and
   direct deliveries, including latency warning assertions.
4. Update the deliverability invariant and run the scoped completion gates.

## Decisions

- Persist `threadIsDirect` rather than a second mutable receipt state. The
  existing `targetKind` plus this immutable route fact reproduces the policy
  already used at acceptance without adding another lifecycle.
- Keep the field nullable so an old writer can coexist with the migration; the
  first new recomputation captures legacy group policy from the pre-transition
  status.

## Verification

- Commands to run: focused Web store/latency tests, the isolated PostgreSQL
  proof, Web and Cloudflare typechecks, schema/migration checks, hosted runner
  bundle/runtime checks, exact-head GitHub Actions, ReviewGPT, and PR preflight.
- Expected outcomes: all checks pass; group intermediate status is
  `sent_no_receipt_expected` with zero missing-receipt warnings; direct
  intermediate status is `accepted` and remains warning-eligible; both become
  `delivered` after their second child receipt.
Completed: 2026-07-30
