# Group usage funding and awareness

Status: completed
Created: 2026-07-20
Updated: 2026-07-21

## Goal

- Let authenticated group members fund the existing synthetic group runtime
  with fixed one-time usage-credit packs and see a coarse group usage state,
  while preserving the current personal top-up, usage-accounting, Stripe,
  messaging, and account-deletion owners.

## Success criteria

- A current member can open `/groups/fund/[joinCode]`, select a server-projected
  $5, $10, or $25 offer, complete Stripe-hosted Checkout, and fund only that
  group's current synthetic runtime beneficiary.
- Group usage reads expose only `healthy`, `low`, or `exhausted`, plus an
  authorized first-party funding URL, without internal USD-micro or personal
  billing facts.
- Group low-usage and exhaustion messaging is route-authorized, idempotent,
  reply-oriented, and uses the existing delivery/retry owners.
- Purchase creation, replay, fulfillment, settlement, refund/dispute
  reconciliation, payer deletion, beneficiary deletion, and detached-payer
  invariants have focused regression proof.
- Personal top-ups retain their current behavior.
- Required acceptance verification, specialist audits, PR ReviewGPT, CI, and
  merge-conflict proof pass with no unresolved accepted findings.

## Scope

- In scope:
  - `apps/web` schema/migration, group authorization, funding page/routes,
    generalized fixed-pack Checkout, Stripe reconciliation, accounting,
    deletion lifecycle, usage status, and focused tests.
  - Existing hosted-execution group-tool and usage-notice contracts only where
    the current public boundary must be extended.
  - Existing Settings top-up UI reuse and the smallest group funding UI.
  - Durable architecture, security, reliability, product-spec, app, and
    verification docs required to describe the shipped behavior.
- Out of scope:
  - Anonymous/public funding, arbitrary amounts, auto-recharge, transfers,
    Family funding, group wallets, a second usage account, new queues or crons,
    and a separate funding-code lifecycle.

## Constraints

- Technical constraints:
  - `apps/web` remains the only billing, Stripe, group-membership, usage-ledger,
    and account-lifecycle owner; Stripe webhook reconciliation remains the only
    grant authority.
  - Reuse the existing group `joinCode` public locator and synthetic
    `HostedMember` beneficiary. Do not add a usage account or funding token.
  - The browser submits only an offer code and request key. Payer, beneficiary,
    Price, amount, Customer, and return destinations are server-derived.
  - Preserve beneficiary-first ledger locking, append-only adjustments,
    included-first FIFO settlement, durable receipt retries, and runtime
    rechecks.
  - Payer deletion may detach fulfilled group purchases only after resolving
    nonterminal payment state; later terminal financial reconciliation must
    remain possible without the payer row.
- Product/process constraints:
  - Treat the supplied malformed patch as behavioral intent, not overwrite
    authority. Reconstruct against current `main` and delete speculative pieces.
  - Do not expose group credit amounts, payer identity, personal plans, Stripe
    references, raw group codes beyond their authorized URL role, or private
    identifiers in logs or artifacts.
  - Keep messaging reciprocal and low-pressure; no recurring nudge mechanism.

## Risks and mitigations

1. Risk: cross-owner payer/beneficiary lifecycle can orphan payment state or
   cascade fulfilled credit.
   Mitigation: explicit nullable-payer terminal invariant, deletion ordering,
   database constraints, and focused concurrent/lifecycle tests.
2. Risk: stale membership or join-code lookup can fund the wrong runtime.
   Mitigation: resolve and revalidate current membership and the exact current
   thread-container relation under web-owned locks before freezing a purchase.
3. Risk: a browser return or replay can grant or retarget credit.
   Mitigation: keep grant authority webhook-only and bind replay to the frozen
   funding target, eligibility policy, offer, and return destination.
4. Risk: Vercel, Cloudflare, and schema deploy skew can strand notices or new
   group-tool fields.
   Mitigation: additive schema/protocol changes, consumer-first rollout where
   required, explicit rollback floors, and post-deploy scenario checks.

## Tasks

1. Reconstruct the supplied intent against current owners and document the
   exact minimal data, authority, and lifecycle changes.
2. Implement schema/service/accounting/deletion behavior with focused tests.
3. Wire authenticated funding, group-tool status, low-usage/exhaustion copy,
   and the reused top-up UI with route/component tests.
4. Update the durable owner docs and deploy contract.
5. Run focused proof, full acceptance, direct scenario/browser proof, and the
   required coverage/frontend audits.
6. Finish the scoped commit, push a draft PR, run ReviewGPT concurrently with
   CI, resolve findings, reconcile current `main`, and report deployment order.

## Decisions

- Reuse the existing opaque group `joinCode` for `/groups/fund/[joinCode]`.
- Keep the synthetic group `HostedMember` as the usage beneficiary.
- Extend the group control surface rather than the personal plan-usage union.
- Generalize the current fixed-pack Checkout core by server-resolved target,
  policy, and return destination.
- Add no group wallet, funding-token lifecycle, scheduler, queue, or low-usage
  table.
- The downloaded reconstructed patch is malformed and incomplete on current
  `main`; it is evidence of intent only.

## Verification

- Commands to run:
  - focused Vitest suites for every changed owner and migration invariant
  - `pnpm test:diff <touched paths>` during iteration
  - `pnpm verify:acceptance` for the final high-risk baseline
  - guarded real-PostgreSQL usage-credit lifecycle/concurrency proof
  - desktop and mobile browser proof for the funding route and dialog states
  - `git diff --check`, privacy/secret/path scans, and parent final diff review
- Expected outcomes:
  - all scripted checks pass; direct proof confirms authenticated group funding,
    coarse group status, replay safety, personal top-up preservation, and
    detached-payer reconciliation behavior.

## Completion evidence

- `pnpm verify:acceptance` passed the workspace typechecks, package coverage,
  6,132 hosted-web tests, 1,844 Cloudflare tests, production Next build, app
  lint, package-boundary checks, fixture coverage, and artifact guards.
- Focused service, route, component, contract, accounting, lifecycle, migration,
  and real-PostgreSQL concurrency suites passed after the final assertion-only
  cleanup.
- Required coverage-write and Codex frontend-review passes ended with no
  unresolved findings. The configured Fable review was unavailable because its
  account had no remaining credits, so the completion workflow used the Codex
  frontend-review substitute.
- The local browser connector exposed no controllable browser target. Route,
  responsive-state, accessibility, dialog-recovery, and production-build proof
  passed, but no desktop or mobile screenshot artifact was captured.
Completed: 2026-07-21
