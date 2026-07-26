# Group-funded usage thank-you celebration

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- After a verified hosted-group usage-credit grant, let the existing group
  Murph send one idempotent, context-aware audio thank-you in the funded group
  using the existing mailbox, assistant-turn, response-media, outbox, and
  delivery owners.
- Land the smallest maintainable cross-owner implementation in a dedicated PR
  and complete the required preliminary and final ReviewGPT gates.

## Success criteria

- Only verified Stripe reconciliation can request the thank-you; browser return
  and unverified payment state cannot.
- Exact reconciliation replay creates at most one group notification.
- The notification resolves and revalidates the exact non-direct group route
  without a personal fallback.
- Durable payloads and model context contain no amount, Stripe/payment
  identifiers, contact details, contributor label, or private payer identity.
- The optional celebration expires 30 minutes after verified payment.
- The isolated group turn receives bounded committed group history and exposes
  exactly the existing voice-memo and song generation tools. Runtime enforces
  exactly one attempt, validates successful media, and does not replay a
  successful generation after a later failure; no broader shell, network, app,
  mutation, or delivery authority is present.
- Normal response-media and outbox delivery remain the sole effect owners.
- Current architecture, security, reliability, product, and verification docs
  accurately describe the shipped behavior and deploy order.
- Canonical verification, product-experience review, preliminary specialist
  ReviewGPT, parent final review, final ReviewGPT, CI, and mergeability proof
  all complete with no unresolved accepted finding.

## Scope

- In scope:
  - Hosted-group usage-credit reconciliation and its post-grant side effect.
  - Existing assistant notification contract/parser/runtime handling.
  - A narrow notification tool profile for group audio celebration.
  - Focused owner and cross-boundary regression coverage.
  - Required durable product/architecture/security/reliability/testing docs.
- Out of scope:
  - New payment, wallet, credit, queue, cron, table, or migration owners.
  - Deterministic thank-you copy, amount disclosure, payer lookup, or browser
    payment-triggered delivery.
  - Generalizing notification tools beyond this demonstrated group use case.
  - Frontend changes.

## Constraints

- Technical constraints:
  - Extend existing public package entrypoints only; keep package dependencies
    one-way and avoid sibling-internal imports.
  - Preserve strict mailbox parsing and additive consumer-first deployment.
  - Preserve verified-webhook grant authority, beneficiary-owned credit, and
    idempotent post-grant runtime recheck behavior.
  - Keep the notification turn isolated from ordinary resident assistant
    continuity and unrelated tool surfaces.
- Product/process constraints:
  - The thank-you is a single reciprocal group moment, not acquisition,
    broadcast, or repeated notification behavior.
  - Preserve group privacy and exact route ownership.
  - Use the guarded worktree, plan/ledger, verification, commit, PR, and
    ReviewGPT workflows without committing review artifacts.

## Risks and mitigations

1. Risk: Reconciliation replay sends duplicate celebrations.
   Mitigation: Derive one stable notification event identity from the fulfilled
   purchase and prove exact replay in owner tests.
2. Risk: Group routing falls back to a contributor's personal thread.
   Mitigation: Reuse the thread-container notification destination and require
   exact current group route revalidation.
3. Risk: Payment or contributor-private data leaks into the model or message.
   Mitigation: Persist a minimal non-financial payload and include a display
   name only when it is already visible in the exact group.
4. Risk: A notification-specific tool path broadens assistant authority.
   Mitigation: Add the smallest closed tool profile and assert the exact exposed
   tools plus every denied capability.
5. Risk: Web, parser/runtime, and warm runner bundles deploy out of order.
   Mitigation: Keep the wire addition additive, document consumer-first rollout,
   immediate bundle convergence expectations, rollback floor, and smoke proof.

## Tasks

1. Inspect the supplied patch against current `main`, current owner docs, and
   overlapping active work; apply it only as behavioral intent.
2. Trace and review the verified-grant, mailbox decode, notification planning,
   assistant tool assembly, response-media, and group delivery paths.
3. Simplify or correct the implementation and add any missing focused proof or
   durable documentation.
4. Run canonical diff verification and full acceptance, plus a direct
   production-faithful scenario where available.
5. Run the required local product-experience review and resolve accepted
   findings.
6. Commit and push the candidate, open the PR with the full intent/change-shape
   contract, and run the preliminary completion-specialists ReviewGPT pass.
7. Resolve preliminary findings, run parent final review and final verification,
   close the plan with the scoped final commit, and push.
8. Run the final ReviewGPT loop concurrently with CI until PASS, then prove the
   final head is green and mergeable.

## Decisions

- Reuse `assistant.notification.requested`; do not introduce another mailbox
  kind or operation owner.
- Use current synthetic group-member visibility and exact group route facts;
  do not persist or resolve a separate payer identity surface.
- Keep audio generation and delivery on existing response-media and outbox
  primitives.

## Verification

- Commands to run:
  - `pnpm test:diff <all touched production owner paths>`
  - `pnpm verify:acceptance`
  - focused Vitest/direct scenario commands identified during implementation
  - `scripts/review-gpt-pr-head-preflight.sh <pr>`
  - preliminary `pnpm review:gpt completion-specialists ...`
  - final `pnpm review:gpt pr-review ...` rounds
  - final PR CI and mergeability checks
- Expected outcomes:
  - All required local and CI checks pass.
  - Product-experience and preliminary specialist review have no unresolved
    accepted findings.
  - The exact final PR patch returns `ROUND_OUTCOME: PASS` with zero accepted
    findings.
