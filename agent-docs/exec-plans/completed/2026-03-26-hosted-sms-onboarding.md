# Hosted SMS-to-passkey onboarding in `apps/web`

## Goal

Add the first hosted onboarding slice for friends/family: accept new Linq text conversations, issue signed invite links with OG previews, bind an invite to a phone-backed hosted user record, let that person create or use a passkey, and kick off a Stripe Checkout flow that can unlock hosted access.

## Scope

- Extend `apps/web` Prisma/Postgres state with hosted user, invite, passkey, session, billing, and webhook-event models.
- Add a hosted onboarding library surface for phone normalization, invite links, passkey registration/authentication, session cookies, Linq webhook handling/outbound replies, and Stripe Checkout/webhook plumbing.
- Add public UI/routes for invite landing, passkey flows, checkout start/success/cancel, and OG image generation.
- Reuse the existing hosted encryption codec for initial per-user secret generation so vault bootstrapping can layer on later.
- Add focused tests/docs/env examples for the new onboarding flow.

## Constraints

- Keep canonical health data out of the hosted app; only onboarding, auth, billing, and bootstrap-secret metadata may persist.
- Do not expose provider tokens, session secrets, or raw vault bootstrap secrets to the browser.
- Keep the change additive inside `apps/web`; do not reshape the local-only `packages/web` app.
- Preserve room for future TEE/E2EE vault work by storing a generated per-user bootstrap secret as encrypted-at-rest server state only for now.

## Risks and mitigations

1. Risk: passkey flows are easy to mis-wire across registration/authentication challenge storage.
   Mitigation: isolate challenge/session helpers, persist short-lived challenge rows, and add focused option/verify tests.
2. Risk: billing and onboarding ownership can drift if Stripe or Linq callbacks arrive out of order.
   Mitigation: store durable checkout/invite/user linkage in Prisma and make webhook handlers idempotent with event/session dedupe.
3. Risk: the app already has hosted device-sync auth semantics.
   Mitigation: keep onboarding auth/session code namespaced separately under `apps/web/src/lib/hosted-onboarding/**` and do not couple it to signed-header browser auth.

## Verification

- Focused: `pnpm --dir apps/web typecheck`, `pnpm --dir apps/web test`
- Required repo commands if dependency/worktree state allows: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Completion workflow audit passes for production-code changes.
