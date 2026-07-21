# Automatically start Pulse after payment setup

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- After a member confirms Start Pulse once, completing Stripe's payment-method
  form automatically resumes the existing trial-to-paid transition when Stripe
  redirects back to Settings. A plain Settings link or canceled Stripe flow
  must never start billing.

## Success criteria

- Stripe's successful payment-method completion return starts the paid Pulse
  transition without a second member click.
- The continuation is short-lived, bound to the authenticated app session and
  member, and required before the automatic POST reaches billing mutation.
- Stripe cancel/back returns to ordinary Settings without automatic billing or
  a redirect loop.
- Existing explicit confirmation, CSRF, idempotency, invoice-paid entitlement,
  and suspended-member protections remain intact.
- Focused tests, apps/web typecheck, required frontend and coverage audits,
  exact-head ReviewGPT, and required CI pass.

## Scope

- In scope: the Start Pulse route/service, short-lived continuation proof,
  Settings return handling, focused tests, and the existing product spec.
- Out of scope: pricing, trial rules, webhook reconciliation, plan cards,
  checkout architecture, database schema, or a new billing state machine.

## Constraints

- Technical constraints: GET remains read-only; automatic continuation requires
  a server-issued HttpOnly signed claim and the successful Stripe flow return;
  provider operations remain replay-safe through existing billing idempotency.
- Product/process constraints: one explicit Start Pulse confirmation remains the
  billing authorization; saving a card is the final required interaction;
  implementation stays in an isolated PR lane and preserves the pre-existing
  hosted local stack.

## Risks and mitigations

1. Risk: an untrusted Settings URL could trigger a charge.
   Mitigation: validate a short-lived session/member-bound server claim before
   rendering or accepting an automatic continuation.
2. Risk: canceling or backing out of Stripe could loop into the portal.
   Mitigation: use a success-only Stripe after-completion return marker and an
   ordinary unmarked cancel return URL.
3. Risk: repeated returns or React remounts could duplicate the operation.
   Mitigation: consume the continuation claim on the first automatic POST and
   retain the service's existing deterministic Stripe idempotency and state
   convergence.

## Tasks

1. Add and test the bounded continuation claim and route enforcement.
2. Split Stripe's successful completion return from cancel/back and add the
   Settings automatic continuation UX.
3. Update the product contract and focused route, service, page, and client
   coverage.
4. Run scoped verification, required audits, local final review, commit, PR,
   ReviewGPT, and CI.

## Decisions

- Reuse the existing app-session HMAC key for a distinct domain-separated
  continuation token; add no database row, schema, timer, queue, or service.
- Keep the return marker non-authoritative. It only asks the server to inspect
  the HttpOnly continuation claim; it cannot authorize billing by itself.
- Mark payment-method setup explicitly inside the service result so hosted
  invoice recovery cannot mint a continuation claim; project that internal
  discriminator out of the public route response.
- Treat automatic start as the exclusive Start Pulse busy state. Suppress all
  competing Start Pulse actions until success/pending navigation, and show one
  user-initiated retry only on a terminal error.

## Verification

- Commands to run: focused Vitest files for the billing service, route,
  continuation token, Settings page, and client component; apps/web typecheck;
  `pnpm test:diff`; required frontend-review and coverage-write audits; Fable UI
  review attempt; exact-head ReviewGPT and required GitHub CI.
- Expected outcomes: automatic completion is covered end-to-end at the
  route/component boundary; forged, expired, mismatched, replayed, canceled, and
  missing-payment cases fail closed; all required gates pass.
- Completed locally: six focused Vitest files (132 tests), `apps/web` typecheck,
  targeted ESLint, coverage-write, and frontend-review all pass. Frontend review
  found and the implementation corrected competing Start Pulse actions during
  automatic continuation; the final review reported no remaining findings.
- Fable UI review and its required Opus fallback both failed before review
  because the local Claude OAuth session is expired. The in-app browser also has
  no available target, so real desktop/mobile Stripe-return rendering remains a
  reported verification gap rather than inferred proof.
- Final coverage-bearing `pnpm test:diff` passed: dependency/boundary/security
  guards, TypeScript, 471 web test files with 5,899 passing tests, ESLint with
  zero errors and eight unrelated existing warnings, dev smoke, and the Next.js
  production build. The existing NFT trace warning remained non-blocking.
- Remaining completion work: scoped commit, pushed PR head, ReviewGPT, and
  GitHub CI.
Completed: 2026-07-20
