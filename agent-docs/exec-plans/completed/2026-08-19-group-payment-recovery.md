# Group sponsorship payment recovery

Status: completed
Updated: 2026-08-19

## Goal

Make monthly group sponsorship payment authority and recovery deterministic so
an explicitly approved payment can fund later refills and a failed refill
always has a truthful, usable recovery path.

Success means:

- a successful monthly sponsorship payment binds the exact reusable Stripe
  PaymentMethod selected for that authorization without guessing from card
  fingerprints or the number of attached methods;
- repeated Checkout use cannot make automatic refill authority ambiguous;
- an explicitly requested recovery can open fresh Checkout even when the
  original failed purchase is older than the ordinary Checkout retry window;
- the funding page never reloads without progress when Checkout cannot open;
  and
- synthetic regressions, direct browser evidence, focused verification,
  exact-head CI, the preliminary specialist pass, and final ReviewGPT all pass
  before merge.

## Scope

- In scope: group sponsorship activation settlement, saved-payment resolution,
  failed-refill recovery, funding-page feedback, their direct tests, member
  documentation, and changelog copy.
- Out of scope: pricing changes, card-fingerprint deduplication, deleting Stripe
  payment methods, new payment providers, or direct production-data mutation.

## Invariants

- Browser return state never grants credit or payment authority.
- Only provider-verified settlement may bind the exact reusable payment method
  for a monthly authorization.
- A payment method must belong to the frozen Stripe customer before it becomes
  refill authority; similar card details or wallet fingerprints are not proof.
- Ambiguous provider outcomes retain the existing purchase and authorization;
  recovery never mints duplicate credit or silently selects another card.
- One-time contributions do not silently change monthly sponsorship authority.
- Tests, review packets, commits, and PR text use synthetic identifiers only.

## Product UX plan

### Outcome

An authenticated sponsor who approves monthly funding can rely on that exact
payment choice for refills and can recover a failed payment without a dead
button or unexplained duplicate-card state.

### Entry and promise

The sponsor enters through the private group funding page. Monthly activation
opens Stripe Checkout, verified settlement enables the authorization, and a
later failed refill exposes one private Review payment action. Recovery either
opens a fresh Stripe Checkout immediately or leaves the page in place with a
clear error and retry path.

### Affected people

- A first-time monthly sponsor completing Checkout with one reusable card.
- An established sponsor whose Stripe customer has several attached direct or
  wallet PaymentMethod records and no prior Customer default.
- A sponsor returning to an old failed refill after the ordinary Checkout retry
  window has elapsed.
- A one-time contributor who must not change another authorization's refill
  authority.

### Proof path

- Provider-shaped settlement tests verify that the exact successful method is
  customer-bound before it becomes the canonical refill method.
- Resolver tests verify that attached-method count and fingerprints never grant
  authority when no exact method is bound.
- Recovery service tests use an old failed purchase and prove the first explicit
  recovery request produces fresh Checkout capability without a second grant.
- Funding-page tests and rendered phone/desktop states prove URL handoff and
  bounded failure feedback.

### Done when

Each selected path has a deterministic charge owner, old failures can recover,
and every successful recovery response causes visible progress. Stripe payment
method deletion and historical inventory cleanup remain deliberately excluded.

## Implementation

1. Trace monthly activation settlement through Stripe event verification and
   the existing authorization owner; identify the smallest exact-method binding
   seam.
2. Add failing provider-shaped regressions for multiple attached methods, exact
   settlement binding, expired recovery, and no-progress UI responses.
3. Implement the owner-local corrections without fingerprint matching, a new
   payment-method lifecycle, or duplicate charge paths.
4. Update member-facing documentation and add one changelog entry for the
   recovery improvement.
5. Run focused suites, Web typecheck/lint, billing guards, and direct rendered
   journey proof; perform the parent candidate review.
6. Push an exact-head PR candidate and launch preliminary specialist and final
   sensitive ReviewGPT rounds concurrently with CI.
7. Resolve accepted findings, obtain ReviewGPT PASS and green required checks,
   close this plan, merge, and retire the worktree.

## Retrospective outcome

The final contract closes current monthly activation and recovery Checkout to
reusable card methods, while ordinary one-time contributions retain dynamic
payment methods. Automatic refill authority remains the exact card from the
latest provider-verified explicit sponsorship payment. An incompatible legacy
method returns to explicit recovery without substitution, and a provider-free
legacy failed refill upgrades to the current policy before recovery Checkout.
No new migration, queue, scheduler, or payment-authority owner was warranted.

## Verification

- Focused Vitest suites for usage-credit purchase, sponsorship authorization,
  Stripe reconciliation, and group funding UI.
- `pnpm --dir apps/web typecheck` and scoped Web lint.
- `pnpm provider-requests:guard` and `pnpm hosted-billing:ci-guard`.
- Synthetic browser proof at the viewports where recovery presentation differs.
- Preliminary Product UX, frontend, and coverage lenses plus the final
  sensitive ReviewGPT gate on the exact pushed PR head.

## Progress

- [x] Reproduce the production failure mechanisms using read-only provider and
  control-plane evidence without persisting private facts.
- [x] Create an isolated task worktree from current `main`.
- [x] Add failing regressions and implement the corrections.
- [x] Complete exact-head verification and direct journey proof: 323 focused
  service/UI/route/reconciliation/changelog tests, Web typecheck and scoped
  lint, both billing guards, and the two-test Chromium responsive journey.
- [x] Resolve the preliminary specialist findings, complete the required
  payment-domain retrospective, and obtain a zero-finding final ReviewGPT PASS
  on the pushed candidate.
- [x] Complete merge preparation: all required GitHub checks are green, the
  parent final review found no remaining gap, and plan closure precedes the
  authorized merge and worktree retirement boundary.
Completed: 2026-08-19
