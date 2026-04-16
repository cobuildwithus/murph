## Goal

Align hosted SMS signup finalization with the Telegram flow so embedded-wallet provisioning uses a fresh Privy user snapshot before completion.

## Scope

- `apps/web/src/components/hosted-onboarding/hosted-auth-completion.ts`
- `apps/web/src/components/hosted-onboarding/hosted-email-auth-button.tsx`
- `apps/web/src/components/hosted-onboarding/hosted-telegram-auth-button.tsx`
- `apps/web/src/components/hosted-onboarding/hosted-phone-auth-support.ts`
- `apps/web/src/components/hosted-onboarding/hosted-phone-auth-controller.ts`
- focused `apps/web/test/**` coverage for hosted phone auth completion

## Constraints

- Preserve existing signup, signin, and link behavior outside the wallet-refresh seam.
- Avoid unrelated hosted onboarding copy, routing, or server identity changes.
- Keep the fix compatible with the current PrivyProvider `createOnLogin` config.

## Verification

- Focused hosted-web tests covering SMS finalization and wallet provisioning
- App-level verification for touched `apps/web` slice per repo policy
