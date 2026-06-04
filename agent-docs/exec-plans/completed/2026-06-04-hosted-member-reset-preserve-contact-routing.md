# Preserve Contact Routing During Hosted Member Reset

## Goal

Change the hosted member reset script so paid members can get a fresh vault and
runtime while keeping the ability to text Murph again without relinking phone,
Linq/SMS, Telegram, or email manually.

## Scope

- Touch only `apps/web/scripts/reset-hosted-member-runtime.ts` and the focused
  reset script tests unless verification reveals a script-local gap.
- Preserve billing, Privy/wallet identity, phone identity, routing, email
  authorization, launch consent, and optional channel consent.
- Continue wiping runtime/vault/mailbox/workspace/device state and forcing a
  fresh activation bootstrap.
- Do not preserve device/wearable connections; reconnecting devices later is
  acceptable, but texting Murph again must not require signup/payment/contact
  relinking.

## Plan

1. Remove contact-routing deletion from the reset script.
2. Update post-reset count assertions to treat routing, phone identity fields,
   email authorization, and non-launch consent as preserved facts.
3. Add focused tests that fail if those contact facts are expected to be zero.
4. Run focused script tests, app typecheck, diff hygiene, and completion review.

## Verification

- `pnpm --dir apps/web test reset-hosted-member-runtime-script.test.ts`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/web test hosted-onboarding-linq-routing.test.ts hosted-onboarding-member-channel-sync.test.ts reset-hosted-member-runtime-script.test.ts`
- `pnpm --dir packages/assistant-runtime test -- hosted-runtime-workspace-entrypoint.test.ts -t "imports system bootstrap before initial conversation import for cold vaults"`
- `git diff --check -- apps/web/scripts/reset-hosted-member-runtime.ts apps/web/test/reset-hosted-member-runtime-script.test.ts agent-docs/exec-plans/active/2026-06-04-hosted-member-reset-preserve-contact-routing.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-06-04
Completed: 2026-06-04
