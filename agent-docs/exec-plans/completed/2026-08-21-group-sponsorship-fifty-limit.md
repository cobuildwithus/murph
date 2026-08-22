# Raise the group sponsorship monthly limit to $50

Status: completed
Created: 2026-08-21
Updated: 2026-08-21

## Goal

Let an authenticated group sponsor choose a $50 monthly maximum through the
existing sponsorship flow without changing the fixed $5 activation purchase,
automatic-refill unit, payment owner, or privacy boundary.

Success means one client-safe sponsorship contract owns the allowed monthly
maximums; activation, management, recovery, and server admission all accept the
same $5, $10, $20, and $50 set; unsupported values still fail closed; and the
existing desktop choices and phone dial remain clear and accessible.

## Product UX

Effort: Product change. This extends the scope of an existing billing choice
without adding a new audience, payment mechanism, or authority relationship.

### Outcome

A group sponsor can authorize up to $50 of fixed $5 usage purchases per month
from the same simple sponsorship controls.

### Entry and promise

The payer enters from the authenticated group funding page. Starting a monthly
sponsorship still charges $5 initially and uses Stripe for payment
confirmation; choosing $50 authorizes later exact-$5 automatic purchases only
when the existing low-capacity and monthly-headroom checks admit them.

### Affected people and recovery

- New sponsor on desktop: sees four prominent monthly maximums, can choose $50,
  and still sees the fixed $5 activation amount before payment.
- New sponsor on a narrow phone: the existing dial has four snap points,
  reports a $50 maximum to assistive technology, and reaches it with pointer or
  End-key input.
- Active payer: can review and confirm an increase to $50 or lower a saved $50
  maximum through the existing management and deferred-decrease behavior.
- Returning payer in payment recovery: the saved $50 maximum renders and
  retries through the existing frozen authorization rather than falling back
  to a lower value.
- Invalid or forged request: a value outside the four allowed maximums is
  rejected before it can become billing authority.

### Deliberate exclusions

- Do not change the exact-$5 activation or refill amount.
- Do not add custom amounts, a new Stripe product, subscription, state owner,
  table, or payment path.
- Do not expose payer, cap, charge, or refill details to the group.

### Done when

- The four limits derive from one shared contract across server and client.
- Focused authorization, checkout, management, and rendered dialog tests pass.
- The real component is inspected at phone and desktop widths on the existing
  design surface, followed by Web typecheck/lint, exact-head CI, preliminary
  Product UX/frontend/coverage ReviewGPT, sensitive final ReviewGPT, and parent
  final review.

## Implementation

1. Move the allowed monthly-limit values and parser into the existing
   client-safe group sponsorship contract, then reuse them from the Web billing
   owner and both sponsorship components.
2. Widen the existing database check constraint to the same four values, then
   add $50 to activation, management, design-study, and focused test fixtures;
   keep all charge and refill mechanics unchanged. Admit that exact migration
   through the existing backward-compatible predeploy allowlist because its
   replacement check is a strict superset accepted by both old and new Web.
3. Update the durable sponsorship contract docs and member changelog.

## Verification

- Run focused Vitest suites for sponsorship authorization, checkout request
  construction, management controls, funding-page projection, and design
  representation.
- Run Web typecheck and lint plus `git diff --check` and a privacy scan of the
  final diff.
- Inspect the existing real-component design representation at desktop and
  narrow-phone widths, including the $50 selection and management state.
- Push the candidate, run preliminary Product UX/frontend/coverage ReviewGPT
  and the sensitive final ReviewGPT gate concurrently with exact-head CI, then
  resolve accepted findings before merge.

## Product UX Walkthrough

Result: Ready.

- New sponsor on desktop: the real sponsorship component projects four choice
  cards, and focused rendered tests prove the $50 selection reaches checkout as
  `5000` while the activation offer remains $5.
- New sponsor on a narrow phone: the rendered dial reports a $5 minimum and $50
  maximum, exposes four labels, and End-key input selects $50.
- Active payer: the design-catalog management state and Playwright flow show a
  $10-to-$50 increase, require the existing confirmation alert, preserve focus
  and safe dismissal, and retry without adding a second payment path.
- Recovery and forged input: the saved typed cap flows through existing
  recovery, the shared parser rejects values outside the four-value set, and
  the migrated PostgreSQL constraint accepts `5000` while rejecting `5001`.
- Proof boundary: the in-app browser was unavailable in this session. The
  repository-owned catalog representation, responsive Playwright journey, and
  rendered component tests provide direct proof; no screenshot was claimed.

## Deployment

Deploy the additive constraint-widening migration before the Web build. The old
Web build remains compatible with the wider database constraint, so this order
creates no forward-deploy gap. Once the new Web build can write a $50
authorization, do not roll Web back below this version because the old closed
parser cannot manage that row. There is no Cloudflare protocol change.
Post-deploy, verify the group funding design surface and a non-charging server
admission check for the $50 value.
Completed: 2026-08-21
