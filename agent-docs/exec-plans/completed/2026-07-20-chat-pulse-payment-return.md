# Chat Pulse payment return

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- After a signed-in member chooses `start_pulse_now` or `continue_pulse` in a
  private Murph conversation and Stripe needs a payment method, completing the
  Stripe Billing Portal flow automatically resumes that exact chosen action.
- Preserve the distinction between ending a trial now and continuing it at its
  natural end, and never let a copied return URL or stale Settings claim change
  subscription intent.
- Keep Stripe as the payment-method UI and extend the existing Pulse trial
  transition owner without adding persisted state, a queue, or another billing
  mutation service.

## Proven gap

- The subscription tool calls the shared Pulse billing service with no browser
  continuation input.
- The service therefore returns an ordinary `/settings#subscription` success
  URL for conversational `start_pulse_now` and `continue_pulse` payment-method
  handoffs.
- Settings only repeats the protected POST when both its marked return query
  and its member-and-session-bound HttpOnly claim are present, so a completed
  chat handoff currently requires another Settings click or another message.

## Architecture and authority

- `billing-start-paid-pulse-service.ts` remains the canonical owner of both
  Pulse trial transitions and Stripe Billing Portal session creation.
- The tool passes an explicit conversational continuation mode; the service
  derives the exact action from its existing transition timing instead of
  accepting a second caller-supplied action.
- The successful Stripe return carries a short-lived HMAC authenticator over
  the member, exact action, and expiry without putting the member id in the URL.
  An authenticated bridge verifies it against the current app-session member,
  then issues the existing HttpOnly browser continuation claim bound to that
  member, app session, and exact action.
- The Settings marker is presentation only. The protected same-origin POST
  consumes the cookie and dispatches the exact action through the existing
  service. Stripe mutation idempotency remains the retry/convergence owner.
- Cancel/back returns to ordinary Settings and performs no automatic mutation.

## Failure, replay, and privacy

- Missing, expired, tampered, or wrong-member return claims fail closed without
  a subscription mutation.
- A valid return claim is short-lived and becomes useful only with the matching
  signed-in member session. The issued HttpOnly claim is cleared after a
  completed, continuing, or billing-pending result; a still-missing Stripe
  method retains it only for an explicit retry and never an automatic loop.
- Retrying an already-completed action converges through the existing service
  and Stripe idempotency; no durable nonce table or reconciliation process is
  introduced.
- URLs and committed artifacts contain no member identifier or payment data.

## Working set

- `apps/web/src/lib/hosted-onboarding/billing-start-paid-pulse-*`
- `apps/web/src/lib/hosted-execution/subscription-tool.ts`
- `apps/web/app/api/settings/billing/**`
- `apps/web/src/components/settings/hosted-start-paid-pulse-button.tsx`
- `apps/web/src/components/hosted-onboarding/client-api.ts`
- `apps/web/app/(dashboard)/settings/page.tsx`
- Focused hosted-web tests and current Pulse trial product specs

## Verification and completion

- Add focused regressions for signed handoff verification, member/action
  binding, cancel versus successful return URLs, exact action dispatch, stale
  Settings-claim isolation, and automatic Settings continuation.
- Run focused Vitest during implementation, then the required full
  `pnpm verify:acceptance` billing/auth baseline.
- Run required `coverage-write` and `frontend-review` specialist passes,
  capture direct fixture-safe scenario evidence, perform the parent final
  review, and attempt the required Claude UI double-check.
- Close through `scripts/finish-task`, push, open the intent-complete PR, start
  ReviewGPT concurrently with CI, resolve every accepted finding, and prove the
  exact final head merges cleanly with current `main`.
Completed: 2026-07-20
