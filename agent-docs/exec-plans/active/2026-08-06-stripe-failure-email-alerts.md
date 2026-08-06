# Stripe failure email alerts

Status: active
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Send privacy-safe internal Resend alerts when a Murph Stripe operation fails
  or Stripe reports a checkout/payment failure, regardless of whether the
  member started the action on the website or through the iMessage assistant.
- Preserve Stripe and the existing Web-owned webhook receipt as billing truth;
  alerts are observability only and never authorize or change billing state.

## Success criteria

- Website and assistant checkout creation failures converge on one alert path
  because both surfaces already call the same Web-owned billing services.
- Verified Stripe failure events for Checkout, PaymentIntent, and subscription
  invoices send one event-scoped alert through the existing shared operational
  Resend configuration.
- A failed Stripe webhook reconciliation sends one event-scoped alert without
  changing its current retry, poison, or entitlement behavior.
- Alerts contain only bounded operational metadata: operation or event type,
  opaque Stripe request/event correlation, error tokens, HTTP status, and
  live/test mode. They exclude member identity, contact details, provider
  payloads, checkout contents, and raw error objects.
- Webhook retries and repeated reporting reuse a stable Resend idempotency key
  and identical payload for the same Stripe event or request.
- Missing or failed Resend configuration never changes the member-visible
  checkout result, webhook acknowledgement, reconciliation retry, or billing
  projection.
- Focused tests, Web typecheck, exact-head CI, preliminary coverage review,
  final ReviewGPT, and parent final review pass.

## Scope

- In scope: shared Stripe failure logging/reporting, verified Stripe webhook
  failure-event reporting, reconciliation-failure reporting, existing shared
  operational Resend configuration, focused tests, and owning docs.
- Out of scope: pricing, checkout UX, customer-facing payment-failure email,
  billing state changes, Stripe retry policy, new queues or schemas, and new
  notification channels.

## Constraints

- Reuse `HostedStripeEvent` for webhook retry identity and the existing
  plain-text Resend transport and operational recipients.
- Add no dependency, persisted state owner, queue, notification framework, or
  iMessage alert fallback.
- Keep alert delivery best-effort and outside billing authority. A Resend
  failure is logged with bounded metadata and must not mask the Stripe failure.
- Preserve unrelated work and use the isolated worktree/PR lane.

## Risks and mitigations

1. Risk: duplicate webhook delivery sends duplicate alert email.
   Mitigation: derive the Resend key and immutable body from the Stripe event
   id and type; Resend suppresses exact retries inside its documented window.
2. Risk: a provider error message echoes private submitted data.
   Mitigation: omit raw/provider messages and payloads from alert content and
   use the existing token-only Stripe error projection.
3. Risk: alert delivery delays or changes a failed member request.
   Mitigation: report only after the Stripe operation has already failed and
   swallow only the alert provider's failure, never the original Stripe error.
4. Risk: separately instrumenting web and iMessage drifts.
   Mitigation: instrument their existing shared Web-owned billing and webhook
   boundaries instead of adding surface-specific behavior.

## Tasks

1. Inventory Stripe failure events, shared call paths, and operational email
   configuration against current provider docs.
2. Implement the smallest privacy-safe Resend alert helper at the existing
   Stripe error and webhook receipt boundaries.
3. Add focused coverage for checkout/API failures, payment-failure events,
   replay identity, redaction, missing configuration, and Resend failure.
4. Update the owning operational/security/reliability documentation.
5. Run focused proof and typecheck, push an exact candidate, complete both
   required ReviewGPT stages with CI, resolve findings, and close the plan.

## Decisions

- Reuse `HOSTED_LINQ_ALERT_EMAIL_FROM` and `HOSTED_LINQ_ALERT_EMAILS`, which are
  already the shared operational Resend transport despite their historical
  names; no configuration migration is justified for this alert family.
- Alert on `checkout.session.async_payment_failed`,
  `payment_intent.payment_failed`, `invoice.payment_failed`, and
  `invoice.finalization_failed`, plus caught Stripe SDK failures and failed
  local Stripe-event reconciliation.
- Treat `checkout.session.expired` and canceled PaymentIntents as ordinary
  abandonment/cancellation rather than errors.
- Apply the preliminary coverage lens. Product-experience, prompt, and
  frontend lenses are not applicable because the change is internal
  operational observability only.
- Run the final PR-lane ReviewGPT gate because this touches billing, provider
  egress, webhook processing, and failure semantics; do not also run local
  `deep-review`.

## Verification

- Commands to run: focused Web Vitest suites for the Stripe alert owner,
  Stripe error logging, webhook service, and event reconciliation; Web
  typecheck; `git diff --check`; exact-head GitHub Actions; preliminary
  `completion-specialists`; and the final ReviewGPT loop.
- Direct proof: simulate one shared checkout API rejection and one verified
  payment-failure webhook replay against an injected Resend transport boundary,
  proving stable keys/body, private-data exclusion, and unchanged original
  failure control flow; the existing Resend transport suite retains HTTP request
  serialization coverage.
