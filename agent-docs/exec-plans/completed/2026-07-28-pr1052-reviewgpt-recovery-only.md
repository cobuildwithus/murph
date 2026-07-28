# Make ambiguous usage top-up recovery non-creating

Status: completed
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Ensure a lost or dismissed usage top-up response can recover an already
  owned purchase without ever turning the rejected amount and request key into
  a later charge.

## Success criteria

- Retrying an ambiguous selection uses the existing checkout endpoint in a
  recovery-only mode.
- Recovery-only requests may return an exact-key purchase or the payer's
  current nonterminal purchase, but never create a purchase or contact Stripe
  when no purchase exists.
- A recovery miss clears the rejected key and returns the payer to a fresh,
  unselected amount picker.
- Personal, Family, and group tests cover lost offer-conflict responses,
  terminal transitions, exact-key recovery, and zero provider I/O.
- The correction is ready for final ReviewGPT, local acceptance, and PR CI
  after its exact head is pushed.

## Scope

- In scope: usage-credit checkout request parsing and routes, purchase-owner
  recovery semantics, top-up dialog state and copy, focused tests, and live
  billing/security/reliability documentation.
- Out of scope: new endpoints, tables, queues, payment owners, retry loops, or
  Stripe policy changes.

## Constraints

- Keep one purchase owner and the existing checkout endpoint.
- Preserve exact-key idempotent recovery and current target-conflict behavior.
- Require a fresh explicit amount selection before any new purchase creation
  after recovery finds no owned purchase.

## Tasks

1. [x] Add failing service and dialog coverage for a lost conflict response
   followed by terminal recovery.
2. [x] Add a narrowly typed recovery-only request and recovery-miss response.
3. [x] Route every ambiguous selection or purchase retry through non-creating
   recovery semantics.
4. [x] Align copy and live invariants with the non-creating recovery contract.
5. [x] Run focused verification and close this implementation plan for its
   exact-head ReviewGPT/acceptance/CI loop.

## Decisions

- A normal amount-selection POST remains the only operation allowed to create
  a purchase.
- A recovery-only POST reuses the same authenticated target route and payer
  lock. It either resolves existing state or returns an explicit recovery miss.
- Resolving existing state may continue that same matching `created` or
  retryable `payment_pending` purchase through its existing provider
  idempotency; recovery-only never creates a replacement purchase.
- A recovery miss is a normal typed outcome, not an error and not durable
  state.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.config.ts
  apps/web/test/hosted-usage-credit-purchase-service.test.ts
  apps/web/test/hosted-usage-top-up-dialog.test.tsx
  apps/web/test/settings-billing-usage-credit-routes.test.ts --no-coverage` —
  183 tests passed.
- `pnpm --dir apps/web typecheck:prepared` — passed.
- Touched-file ESLint — passed.
- `pnpm docs:drift` — passed.
- `git diff --check` — passed.
- Product-experience recheck after correcting matching-purchase continuation —
  `NO FINDINGS`.
- Canonical `pnpm test:diff apps/web packages/assistant-engine` — passed,
  including 7,004 Web tests, lint, dev smoke, and production build.
- Local acceptance, final ReviewGPT, and PR CI continue against the pushed
  exact head.
Completed: 2026-07-28
