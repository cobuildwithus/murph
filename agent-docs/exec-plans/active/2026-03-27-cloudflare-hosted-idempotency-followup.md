# 2026-03-27 Cloudflare Hosted Idempotency Follow-Up

## Goal

Land the next hosted idempotency step for hosted onboarding webhooks:

- webhook-owned durable state updates still happen first
- externally visible hosted side effects are materialized as durable receipt-local intents before send
- retries resume unsent hosted side effects instead of recomputing or replaying everything blindly
- Cloudflare dispatch effects use deterministic event ids so resend attempts reconcile instead of fanning out duplicate hosted runs
- the remaining residual edge is explicit where the upstream transport itself does not offer stronger idempotency

## Constraints

- Work on top of the already-dirty `apps/web` hosted onboarding tree without reverting adjacent Privy, RevNet, or receipt-state edits.
- Keep the change scoped to hosted onboarding webhook side effects; do not broaden into unrelated `apps/web` auth, billing, or device-sync flows.
- Reuse the existing hosted webhook receipt row as the durable retry journal unless a stronger reason appears.
- Preserve current webhook-visible behavior and error codes unless the retry-safe outbox flow requires a narrow adjustment.

## Planned Shape

1. Extend hosted webhook receipt state with a typed side-effect list that can remember pending versus sent hosted effects across retries.
2. Queue desired hosted side effects after durable webhook work decides what should happen:
   - hosted execution dispatches
   - hosted Linq invite replies
3. Drain those receipt-local effects after the durable work succeeds, marking sent effects back onto the receipt state.
4. Replace unstable hosted member-activation dispatch ids with deterministic ids derived from the owning webhook event so resend attempts reconcile cleanly.
5. Keep RevNet issuance on its dedicated issuance-state path for now, but update the follow-up docs to describe the new narrower remaining gap accurately.

## Verification Target

- Focused hosted onboarding webhook idempotency tests that prove sent effects are not replayed on retry when their durable sent marker exists.
- Focused `apps/web` test/typecheck coverage for any changed hosted onboarding helpers.
- Required repo commands after integration: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.

## Status

- Implemented receipt-local side-effect state on hosted webhook receipts for Cloudflare dispatches and Linq invite replies, plus deterministic hosted member-activation dispatch ids derived from the owning Stripe event.
- Focused verification passed:
  - `pnpm --dir apps/web typecheck`
  - `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-onboarding-webhook-idempotency.test.ts`
- Repo-wide `pnpm typecheck` passed.
- Repo-wide `pnpm test` and `pnpm test:coverage` are currently blocked by unrelated in-flight `apps/web` landing/Privy export mismatches outside this plan's scope:
  - missing `hasHostedPrivyPhoneAuthConfig` from `apps/web/src/lib/hosted-onboarding/landing.ts`
  - missing `parseHostedPrivyIdentityToken` from `apps/web/src/lib/hosted-onboarding/privy-shared.ts`

## Risks

1. Hosted webhook receipt updates now carry more retry state, so stale optimistic updates could hide sent markers.
   Mitigation: keep one typed serializer/parser, update through narrow helpers, and add retry-focused regression tests.
2. Linq outbound sends still have the residual "send succeeded but sent marker write failed" edge because Linq does not expose a stronger idempotency contract here.
   Mitigation: persist the outbox state before sending, treat invite `sentAt` as non-blocking metadata, and document the remaining residual edge explicitly.
3. Hosted activation dispatch now depends on deterministic event ids.
   Mitigation: derive them from stable webhook event ids and assert the retry path reuses the same payload.
