# PR 996 saved-card group funding completion

Status: completed
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Complete PR 996 on its existing branch so an authenticated group contributor can explicitly fund with a reusable Stripe card without repeating Checkout, while first-time, ambiguous, declined, or authentication-required payments retain a safe Checkout recovery path.

## Success criteria

- A canonical reusable card attached to the authenticated payer's Stripe Customer can fund the exact server-resolved group beneficiary after one explicit click.
- The direct PaymentIntent is durably bound before confirmation, survives ambiguous provider responses, and never grants credit outside verified webhook reconciliation.
- Missing, ambiguous, declined, canceled, or authentication-required saved-card attempts converge on the existing Checkout flow without duplicate charge or grant risk.
- Checkout securely saves the entered card for later eligible group contributions without Murph storing card data.
- The production component is represented in the design catalog with responsive proof, and focused tests, typecheck, full acceptance, product review, specialist review, final ReviewGPT, and exact-head CI complete.

## Scope

- In scope: group-only saved-card selection and PaymentIntent lifecycle, shared usage-credit payment proof/reconciliation needed by direct payments, first-time Checkout save behavior, group funding dialog copy, design-catalog study, focused tests, and current owner documentation.
- Out of scope: personal or Family direct charges, automatic/repeating charges, arbitrary amounts, a Murph card store, schema changes, new ledgers/queues/reconcilers, subscription billing, or anonymous funding.

## Constraints

- Keep Stripe as the source of truth for reusable payment methods and `apps/web` as the sole owner of payer, beneficiary, offer, purchase, and grant authorization.
- Require a user action for every contribution; being signed in is identity proof, not payment consent.
- Preserve the existing durable purchase and append-only credit ledger as the only ambiguity and fulfillment owners.
- Prefer deletion, reordering existing durable writes, and narrow helpers over new state, abstractions, or dependencies.

## Risks and mitigations

1. Risk: confirming a PaymentIntent before persisting its identity can strand an ambiguous charge.
   Mitigation: create idempotently, bind the unconfirmed intent under the payer-owned purchase fence, then confirm by ID and recover by the stored reference.
2. Risk: falling back while a direct intent can still succeed can double-charge.
   Mitigation: offer Checkout only after the exact direct intent is proven canceled or otherwise terminal, and keep one purchase-scoped provider identity at a time.
3. Risk: webhook ordering across direct and Checkout payments could grant twice or misapply refunds/disputes.
   Mitigation: re-fetch live Stripe state, bind exact intent/charge/customer/amount/mode metadata, and converge through the existing semantic-source and reconciliation-version fences.
4. Risk: one-click copy could imply automatic charging or hide 3DS/recovery behavior.
   Mitigation: use explicit action copy, immediate progress feedback, and truthful Checkout/reconciliation recovery states in the real cataloged component.
5. Risk: an ambiguous direct response followed by a new amount could recover
   the earlier frozen charge under mismatched consent copy.
   Mitigation: keep the original amount and request key locked in the group UI,
   and reject same-target active-purchase recovery when the submitted offer
   differs from the frozen offer.
6. Risk: the added recovery content can leave a short mobile viewport scrolled
   below the dialog identity and close control.
   Mitigation: on the first locked-recovery transition, restore the real dialog
   scroll container to the top and focus its title without scrolling.

## Tasks

1. Inspect the exact PR head, failed checks, current Stripe lifecycle, and changed tests to prove remaining gaps.
2. Rework only the unsafe or over-complex parts of the direct payment path and add focused regression coverage.
3. Update the design catalog and durable owner docs where the implemented contract changed.
4. Run focused verification, canonical `pnpm test:diff`, full `pnpm verify:acceptance`, responsive browser proof, product review, and the required Claude UI pass.
5. Commit and push the exact candidate, run preliminary specialist ReviewGPT with CI, resolve findings, complete parent review and plan closure, then run final ReviewGPT with final-head CI and mark PR 996 ready.

## Decisions

- Continue on `agent/reuse-saved-card-for-group-funding-v2`; do not create a replacement branch or PR.
- Limit direct saved-card charging to group funding, matching the requested user outcome and avoiding a broader billing-policy change.
- Select only one consistent Customer/nonterminal-Subscription default card or
  one unambiguous attached card; otherwise preserve Checkout.
- Freeze new purchases at request policy v2. Keep v1 reconstruction unchanged
  so an in-flight Checkout idempotency key never receives a different request
  shape; only v2 group Checkout saves a future-use card.
- Keep a direct PaymentIntent bound in `payment_pending` after ambiguous
  confirmation. The active purchase projection and dialog expose exact-request
  retry authority for that state instead of creating another purchase.
- Product-experience review found and the implementation accepts the
  ambiguous-response amount-consent gap: group recovery now names the uncertain
  payment, hides amount changes, reuses the exact request key, and fails closed
  on a new-key offer mismatch server-side.
- The valid preliminary specialist pass returned two accepted findings. The
  test-only artifact now proves that a rejected cancellation followed by a
  succeeded retrieval cannot open Checkout, and the parent-owned frontend fix
  restores the mobile dialog heading/focus before showing recovery.
- Two earlier preliminary attempts were invalid tooling/evidence passes rather
  than substantive reviews: the first omitted the required model confirmation;
  the second captured a ghost action under hover. Both gaps were corrected
  without changing the reviewed product behavior before the one valid pass.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-usage-credit-purchase-service.test.ts apps/web/test/hosted-usage-credit-stripe-reconciliation.test.ts apps/web/test/hosted-usage-top-up-dialog.test.tsx --no-coverage` — 164 tests passed after the accepted product-review consent fix and first specialist coverage patch.
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-usage-credit-purchase-service.test.ts apps/web/test/hosted-usage-top-up-dialog.test.tsx --no-coverage` — 121 tests passed after the valid preliminary specialist findings were resolved.
- `pnpm --dir apps/web typecheck:prepared` — passed.
- `pnpm --dir apps/web lint` — passed with zero errors; remaining warnings are
  pre-existing outside the task after task-owned warnings were removed.
- `MURPH_CRABBOX_BLACKSMITH=1 pnpm test:diff apps/web` — passed in one
  one-shot 16-vCPU Testbox; app tests, lint, typecheck, build, dev smoke, and
  repository guards all passed.
- The same canonical command passed again after the preliminary specialist
  remediation in one-shot Testbox `tbx_01kygjnznzw8b4p84wgettbqgf`.
- `MURPH_CRABBOX_BLACKSMITH=1 pnpm verify:acceptance` — the Web and Cloudflare
  app verification surfaces passed, but the repo-wide command failed on the
  unrelated current-`main` CLI release-audit mismatch: the test expects
  `@cobuild/review-gpt` `^0.5.114` while the root manifest already declares
  `^0.5.117`. Neither file is changed by this task.
- Desktop 1440x1000 and mobile 390x844 `/design?tab=sections` screenshots cover
  the real selection, direct-charge loading, ambiguous-response recovery, and
  exhausted pending-payment recovery states. The ambiguous mobile state was
  recaptured after the focus/scroll correction with its full heading and close
  control visible on entry.
- Claude Code Fable UI double-check was attempted after rendered evidence was
  stable and stopped at explicit usage-credit exhaustion, the documented
  non-blocking gap.
- Product-experience review, preliminary specialist ReviewGPT, parent final
  review, and exact-head substantive CI are complete. Final ReviewGPT and its
  final-head CI pass remain pending.
Completed: 2026-07-26
