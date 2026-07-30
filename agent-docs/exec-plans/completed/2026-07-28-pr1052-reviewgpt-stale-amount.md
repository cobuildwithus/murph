# PR 1052 ReviewGPT stale-amount recovery remediation

Status: completed
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Resolve ReviewGPT round 2's stale-tab amount-conflict finding without
  weakening the payer-wide purchase fence or introducing another payment owner.

## Success criteria

- A fresh different-amount request returns the frozen purchase's
  status/cancel-only projection before provider I/O.
- The rejected amount and fresh request key never become a retry action.
- Personal and Family recovery cover `created`, `checkout_open`, and
  `payment_pending`, including a later terminal transition.
- Same-offer and exact-key recovery behavior remains unchanged.
- Focused tests, Web typecheck, lint, docs drift, acceptance verification, CI,
  and the final ReviewGPT loop pass on the pushed exact head.

## Scope

- In scope: usage-credit purchase resolution, browser response parsing and
  recovery presentation, focused regression tests, and live billing-owner docs.
- Out of scope: new payment endpoints, durable payment state, offer changes,
  Stripe provider policy changes, or unrelated hosted-runtime failures.

## Constraints

- Technical constraints: retain one frozen purchase as the source of truth;
  expose no URL or retry capability for a different amount; perform no Stripe
  I/O on the conflict path.
- Product/process constraints: require a fresh amount selection and explicit
  authorization after the frozen purchase becomes terminal; preserve the
  immutable ReviewGPT baseline and review only remediation deltas.

## Risks and mitigations

1. Risk: A definitive conflict is mistaken for an ambiguous provider outcome.
   Mitigation: Mark the response as an offer conflict and transition directly
   to the frozen purchase screen while discarding the fresh request key.
2. Risk: A stale retry later starts a second charge after the frozen purchase
   becomes terminal.
   Mitigation: Make offer-conflict responses mutually exclusive with payable
   URLs and retry capability, then require a fresh selection after terminal
   recovery.

## Tasks

1. Return a status/cancel-only frozen-purchase response for amount conflicts.
2. Present the frozen purchase without retaining the rejected amount or key.
3. Add personal and Family state/terminal-transition regression coverage.
4. Align live security, reliability, and product-owner docs.
5. Verify, commit, push, and run ReviewGPT to a passing final outcome.

## Decisions

- Reuse the existing purchase projection and dialog state machine; add only an
  explicit `offerConflict` response marker so a missing Checkout URL is
  intentional and fail-closed.

## Verification

- Commands to run: focused Web Vitest suites, hosted Web typecheck, touched-file
  ESLint, `pnpm docs:drift`, `git diff --check`, `pnpm test:diff ...`,
  `pnpm verify:acceptance`, PR CI, and the final ReviewGPT remediation round.
- Expected outcomes: all feature-owned checks pass; any unrelated hosted-E2E
  infrastructure failure is proven and rerun; ReviewGPT returns `PASS`.
Completed: 2026-07-28
