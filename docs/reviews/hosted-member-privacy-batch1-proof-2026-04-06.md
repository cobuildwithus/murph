# Hosted-member privacy Batch 1 proof note

Last updated: 2026-04-06

## Purpose

This note records live-tree proof for the narrow Batch 1 privacy assumptions.
It is intentionally about the current repo state, not the desired end state.

## Locked from the live tree

### Four-lane split to preserve during Batch 1

- Entitlement stays on `HostedMember`.
  - Direct proof:
    - `apps/web/prisma/schema.prisma` keeps `status` and `billingStatus` on `HostedMember`.
    - `apps/web/src/lib/hosted-onboarding/entitlement.ts` derives access from `memberStatus` and `billingStatus`.
    - `apps/web/src/lib/hosted-onboarding/request-auth.ts` uses those same member fields to gate active access.
- Identity should move to `HostedMemberIdentity`.
  - Direct proof of the current wide-row coupling:
    - `apps/web/prisma/schema.prisma` keeps `normalizedPhoneNumber`, `phoneNumberVerifiedAt`, `privyUserId`, and wallet fields on `HostedMember`.
    - `apps/web/src/lib/hosted-onboarding/member-identity-service.ts` creates, reconciles, and looks up members by phone lookup key, `privyUserId`, and wallet address on that row.
    - `apps/web/src/lib/hosted-onboarding/request-auth.ts` resolves the authenticated member through `findHostedMemberForPrivyIdentity(...)`.
- Routing should move to `HostedMemberRouting`.
  - Direct proof of the current wide-row coupling:
    - `apps/web/prisma/schema.prisma` keeps `linqChatId`, `telegramUserId`, and `telegramUsername` on `HostedMember`.
    - `apps/web/src/lib/hosted-onboarding/member-identity-service.ts` writes the Linq chat binding through `persistHostedMemberLinqChatBinding(...)`.
    - `apps/web/src/lib/hosted-onboarding/member-activation.ts` and `apps/web/src/lib/hosted-onboarding/stripe-billing-policy.ts` read `linqChatId` from `HostedMember` to build first-contact routing.
    - `apps/web/app/api/settings/telegram/sync/route.ts` writes `telegramUserId` and `telegramUsername` on `HostedMember`, and `apps/web/src/lib/hosted-onboarding/webhook-provider-telegram.ts` resolves the member by that same field.
- Billing refs should move to `HostedMemberBillingRef`.
  - Direct proof of the current wide-row coupling:
    - `apps/web/prisma/schema.prisma` keeps `stripeCustomerId`, `stripeSubscriptionId`, `stripeLatestCheckoutSessionId`, `stripeLatestBillingEventCreatedAt`, and `stripeLatestBillingEventId` on `HostedMember`.
    - `apps/web/src/lib/hosted-onboarding/billing-service.ts`, `stripe-billing-events.ts`, and `stripe-billing-policy.ts` read and write those Stripe references directly on `HostedMember`.

### Verified email is out-of-Postgres state

- Direct proof:
  - `apps/web/app/api/settings/email/sync/route.ts` extracts the verified email from the server-side Privy identity state, then calls `syncHostedVerifiedEmailToHostedExecution(...)`.
  - `apps/web/src/lib/hosted-execution/control.ts` writes that value through `client.updateUserEnv(...)` using `createHostedVerifiedEmailUserEnv(...)`.
  - `packages/runtime-state/src/hosted-user-env.ts` defines the hosted verified-email storage shape as user-env keys, not database fields.
  - `apps/cloudflare/src/user-runner/runner-user-env.ts` persists the verified email in the encrypted per-user env object and derives hosted email routing from that env state.
  - `apps/cloudflare/src/index.ts` authorizes inbound hosted email by reading the verified email back from the per-user env object.
  - `apps/web/prisma/schema.prisma` contains no `email` field on `HostedMember` or related hosted onboarding models.
- Existing proof coverage already in tree:
  - `apps/web/test/hosted-execution-control.test.ts`
  - `apps/web/test/settings-email-sync-route.test.ts`
  - `packages/runtime-state/test/hosted-user-env.test.ts`
  - `apps/cloudflare/test/hosted-email.test.ts`

### RevNet is environment-gated

- Direct proof:
  - `apps/web/src/lib/hosted-onboarding/revnet.ts` enables RevNet only when the full hosted RevNet environment is present.
  - `apps/web/src/lib/hosted-onboarding/billing-service.ts` passes `requireWalletAddress: isHostedOnboardingRevnetEnabled()` into wallet resolution, so wallet requirement is conditional on RevNet enablement.
  - `apps/web/src/lib/hosted-onboarding/entitlement.ts` treats RevNet readiness as conditional through `revnetRequired`.
- Existing proof coverage already in tree:
  - `apps/web/test/hosted-onboarding-env.test.ts` proves partial RevNet config is rejected and full config is subscription-only.
  - `apps/web/test/hosted-onboarding-billing-service.test.ts` proves checkout requires a stored wallet in the RevNet-enabled path.
  - `apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts` proves `invoice.paid` activates access when RevNet is disabled.

## Still proof-required

### `HostedSession` removal is not justified yet

- Direct proof gathered in this lane:
  - Searching non-test runtime code for `HostedSession` under `apps/web` found only the Prisma relations and model in `apps/web/prisma/schema.prisma`.
  - Searching `apps/web/test/**` found only test-harness references in `apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts`.
- What that means:
  - The current live repo does not show an in-repo runtime reader or writer for `HostedSession`.
  - That is still not enough proof to remove it safely.
- Required stance for later cleanup:
  - Keep `HostedSession` in Prisma for now.
  - Treat removal as proof-required until there is direct end-to-end evidence that no runtime path, migration expectation, or deploy-time dependency still needs it.

## Open gaps

- `UNCONFIRMED`: whether any deployed code outside this live tree still depends on `HostedSession`.
- `UNCONFIRMED`: whether every auth-stage caller is safe to decouple from wallet presence immediately.
  - Current live-tree evidence says the invite-stage heuristic in `apps/web/src/lib/hosted-onboarding/invite-service.ts` still computes `hasPrivyIdentity` as `privyUserId && walletAddress`.
  - That is evidence of current coupling, not evidence that wallet should stay mandatory when RevNet is disabled.
  - The actual auth/onboarding cutover belongs in the later Batch 2 lane.

## Lane decision

- Batch 1 should stay additive:
  - entitlement remains on `HostedMember`
  - identity moves to `HostedMemberIdentity`
  - routing moves to `HostedMemberRouting`
  - billing refs move to `HostedMemberBillingRef`
- Email remains documented as hosted execution env / Cloudflare route state, not Postgres identity state.
- `HostedSession` remains explicitly deferred pending stronger proof.
