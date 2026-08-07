# Stripe failure email alerts

Status: completed
Created: 2026-08-06
Updated: 2026-08-07

## Goal

- Send privacy-safe internal Resend alerts when a Stripe rejection aborts a
  Murph checkout or Stripe reports a checkout/payment failure, regardless of whether the
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
  opaque stable operation-attempt or Stripe request/event correlation, error tokens, HTTP status, and
  live/test mode. They exclude member identity, contact details, provider
  payloads, checkout contents, and raw error objects.
- Webhook retries and repeated reporting reuse a stable Resend idempotency key
  and identical payload for the same Stripe event or operation attempt.
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
   Mitigation: let only the user-action owner report after the Stripe operation
   has already failed; keep absorbed/recovered diagnostics log-only; and
   swallow only the alert provider's failure, never the original Stripe error.
4. Risk: separately instrumenting web and iMessage drifts.
   Mitigation: instrument their existing shared Web-owned billing and webhook
   boundaries instead of adding surface-specific behavior.

## Tasks

1. [x] Inventory Stripe failure events, shared call paths, and operational email
   configuration against current provider docs.
2. [x] Implement the smallest privacy-safe Resend alert helper at the existing
   checkout-action and webhook receipt boundaries.
3. [x] Add focused coverage for checkout/API failures, payment-failure events,
   replay identity, redaction, missing configuration, and Resend failure.
4. [x] Update the owning operational/security/reliability documentation.
5. [x] Run focused proof and typecheck, push an exact candidate, complete both
   required ReviewGPT stages with CI, resolve findings, and close the plan.

## Decisions

- Reuse `HOSTED_LINQ_ALERT_EMAIL_FROM` and `HOSTED_LINQ_ALERT_EMAILS`, which are
  already the shared operational Resend transport despite their historical
  names; no configuration migration is justified for this alert family.
- Alert on `checkout.session.async_payment_failed`,
  `payment_intent.payment_failed`, `invoice.payment_failed`, and
  `invoice.finalization_failed`, plus Stripe SDK rejections that abort checkout
  create/resume and failed local Stripe-event reconciliation.
- Treat `checkout.session.expired` and canceled PaymentIntents as ordinary
  abandonment/cancellation rather than errors.
- Apply the preliminary product-experience and coverage lenses because the
  requested operator email is an asynchronous delivery and recovery workflow.
  Prompt and frontend lenses are not applicable.
- Run the final PR-lane ReviewGPT gate because this touches billing, provider
  egress, webhook processing, and failure semantics; do not also run local
  `deep-review`.

## Verification

- Commands to run: focused Web Vitest suites for the Stripe alert owner,
  integrated Resend delivery, Stripe error logging, webhook service, and event reconciliation; Web
  typecheck; `git diff --check`; exact-head GitHub Actions; preliminary
  `completion-specialists`; and the final ReviewGPT loop.
- Direct proof: simulate one shared checkout API rejection and one verified
  payment-failure webhook replay against an injected Resend transport boundary,
  proving stable keys/body, private-data exclusion, and unchanged original
  failure control flow; the existing Resend transport suite retains HTTP request
  serialization coverage.

## Review remediation

- Accepted the preliminary and final-round finding that the shared Stripe
  diagnostic logger also observes recovered races and retry-owned work. It is
  log-only again; operation email is owned only by terminal checkout-action
  boundaries that propagate the provider rejection to the caller.
- Replaced random request-id fallback with a stable opaque operation-attempt
  correlation and included that correlation plus live/test mode in the email.
  A real Stripe request id still distinguishes separate provider requests on
  the same attempt.
- Added integrated proof through the real alert helper and Resend transport,
  including two failed reconciliation claims producing exactly one
  reconciliation email and zero retry-attempt operation emails.
- Final round 2 correctly found that selected Checkout Session calls were still
  too narrow: a mandatory price read could abort the same user action before
  those calls. The anomaly retrospective fixed the requirement at one alert per
  terminal failed action occurrence. Ordinary, Family, and usage-credit action
  owners now span mandatory price lookup, customer provisioning, saved-card
  preparation, and Checkout Session create/resume while recovered projections,
  absorbed cleanup/race outcomes, and exact replays remain silent.
- Added direct Resend transport proof for ordinary and Family checkout failures,
  early usage-credit price-read failure, final Session failure, saved-card
  preparation failure, group customer provisioning failure, stable exact
  replay identity, recovered purchase projection, and non-Stripe action errors.
- Final round 3 found three remaining occurrence-identity gaps. Family checkout
  restart now leaves the completed stale attempt and runs the replacement as a
  separately wrapped current attempt, so a failure and its retry use the
  replacement attempt identity. Direct paid Family upgrades now reuse their
  complete provider-effect idempotency identity, including current plan and
  Price plus target Price and seat count. Explicit group-sponsorship recovery
  now reports a propagated checkout failure at its action boundary while a
  no-charge reactivation remains silent.
- Added regression proof for a stale Family attempt replaced before a
  request-id-free failure, distinct two-seat and three-seat direct provider
  effects with stable replay, explicit group recovery failing during mandatory
  Price read or Session creation, and passive no-charge recovery.
- Final round 4 found that every successful Family checkout returns a
  Murph-owned redirect whose mandatory Session read was still log-only. The
  redirect now reports a real provider rejection only after the submitted
  Session's unique blind binding resolves to a current checkout attempt; an
  unknown, cleared, or stale public ID remains silent, and the retryable 409 is
  unchanged.
- Added real Resend transport proof for a request-id-free current redirect
  failure with stable replay, an unbound valid Session ID with zero email, and
  a successful open Session with zero email.
- Final round 6 found that removing alert eligibility from the shared diagnostic
  logger left two Web-owned subscription actions without a terminal action
  owner. Paid-plan upgrades and paid-trial transitions now report only after
  their complete provider-backed action aborts. The adjacent scheduled plan
  switch uses the same ownership rule, including Assistant callers that already
  share these services.
- Added real Resend transport proof for request-id-free plan-upgrade,
  paid-trial, scheduled-switch, and cardless Group payment-setup failures.
  Stable replays retain the same body and Resend key, while recovered ambiguous
  mutations, already-applied outcomes, and domain conflicts schedule no email.
- Final round 7 found that paid Family capacity changes and member-tier swaps
  still relied on the now log-only SDK diagnostic wrappers. Both complete
  actions now own their terminal provider-failure alert. Capacity updates reuse
  their exact Stripe idempotency key; member-tier swaps reuse the persisted
  transition idempotency key. The per-call diagnostic wrappers were deleted so
  one failed action cannot double-log or double-email.
- Added real Resend transport proof for request-id-free capacity-read and
  member-tier update failures across stable replays, plus explicit silence for
  successful, already-applied, and domain-only outcomes.
- Final round 8 found that several provider adapters preserved only
  request-id presence when translating raw Stripe failures into hosted errors.
  Distinct provider requests on the same action could therefore collapse onto
  the stable fallback email key. The translation boundary now retains only the
  validated opaque request id in a frozen non-serialized correlation record;
  client-visible details remain presence-only and raw provider data is still
  discarded.
- Added real Resend proof that plan-upgrade and usage-credit actions distinguish
  two provider request ids, deduplicate replay of the same request id, preserve
  request-id-free fallback behavior, and omit the exact id from client-visible
  serialized errors.
- Final round 9 found that the first safe-correlation implementation imported
  the server-only alert module from the general onboarding runtime. That runtime
  also serves the mandatory production line-sync migration and standalone
  Stripe tools, so the coupling would abort those ordinary Node entry points.
  The validated request-id parser and frozen cause constructor now live in a
  dependency-free Stripe field module imported by both runtime and alert code.
- Production-shaped child-process proof runs the exact line-sync package command
  with Node server conditions unset and reaches its existing environment gate;
  the legacy Stripe migration likewise reaches its own required mode gate.
- Final round 10 passed with no findings after verifying the dependency-free
  runtime boundary, action/webhook/reconciliation ownership, Resend replay and
  privacy behavior, and production-shaped standalone command coverage.

## Final verification

- Focused Stripe Web Vitest: 14 files and 647 tests passed.
- Runtime-boundary remediation regression: 4 files and 203 tests passed.
- Web TypeScript, targeted ESLint, `pnpm logs:guard`,
  `pnpm stripe-requests:guard`, `pnpm docs:drift`, `git diff --check`, and the
  direct-identifier scan passed.
- The corrected preliminary specialist pass and final ReviewGPT round 10 both
  passed with no remaining findings.
- Exact-head GitHub Actions passed on the branch reconciled with current
  `main`: release build/typecheck, app verification, fixture coverage, CLI and
  platform/assistant package coverage, both CLI host matrices, repository
  hygiene, frontend design proof, viewport overflow, the release aggregate,
  and Vercel's configured ignored-build check.
- Production configuration-name proof exists for the Resend API key, sender,
  and recipient-list variables, and read-only production receipts confirm an
  `invoice.payment_failed` delivery. Live Stripe endpoint subscription and
  exact recipient-membership inspection remain a deployment follow-up that
  requires explicit approval to inject production-only secret values without
  printing or persisting them.
Completed: 2026-08-07
