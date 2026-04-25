# Join Invite Masked Phone Shortcut

## Goal

Restore the no-reentry join invite phone verification shortcut while keeping raw phone numbers out of initial invite status, page data, and visible UI.

## Scope

- `apps/web/src/lib/hosted-onboarding/invite-service.ts`
- `apps/web/src/components/hosted-onboarding/{hosted-invite-phone-auth,hosted-phone-auth-controller,hosted-phone-auth-step-views}.tsx`
- Directly coupled hosted onboarding tests.

## Constraints

- Do not restore raw `phonePrefill` on invite status/page payloads.
- Do not display a raw phone number in the UI.
- Privy SMS login remains client-SDK based; avoid undocumented server-side Privy endpoints.
- Preserve unrelated dirty-tree and ledger work.
- Accepted tradeoff: the no-reentry shortcut returns the stored phone number from the user-initiated `/send-code` action so the Privy client SDK can send the SMS; this hides the raw number from initial page data and visible UI, but it is not a server-side SMS send.

## Verification Plan

- Focused hosted phone auth, invite send-code, member service, route, and join client tests.
- `apps/web` typecheck/lint where feasible.
- Diff whitespace check.

## Verification Results

- `pnpm exec vitest run apps/web/test/hosted-phone-auth.test.ts --config apps/web/vitest.config.ts --no-coverage`
- `pnpm exec vitest run apps/web/test/hosted-phone-auth.test.ts apps/web/test/hosted-onboarding-invite-send-code.test.ts apps/web/test/hosted-onboarding-member-service.test.ts apps/web/test/hosted-onboarding-routes.test.ts apps/web/test/join-invite-client.test.ts apps/web/test/hosted-onboarding-privy-invite-status.test.ts apps/web/test/hosted-onboarding-invite-status-route.test.ts --config apps/web/vitest.config.ts --no-coverage`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/web lint`
- `git diff --check`
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-onboarding/invite-service.ts apps/web/src/components/hosted-onboarding/hosted-invite-phone-auth.tsx apps/web/src/components/hosted-onboarding/hosted-phone-auth-controller.ts apps/web/src/components/hosted-onboarding/hosted-phone-auth-step-views.tsx apps/web/test/hosted-onboarding-member-service.test.ts apps/web/test/hosted-onboarding-invite-send-code.test.ts apps/web/test/hosted-onboarding-routes.test.ts apps/web/test/hosted-phone-auth.test.ts`
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
