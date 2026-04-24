# Hosted onboarding privacy and mutation boundary fixes

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Stop unauthenticated invite phone-code preparation from exposing recoverable phone numbers.
- Enforce invite phone-code cooldown against in-flight attempts as well as confirmed sends.
- Block suspended hosted members before identity, contact, or routing mutations.
- Narrow directly coupled hosted auth and billing read/input seams where the current code takes more state than it uses.

## Scope

- `apps/web/app/api/hosted-onboarding/invites/[inviteCode]/send-code/route.ts`
- `apps/web/app/api/hosted-onboarding/billing/checkout/route.ts`
- `apps/web/app/api/settings/{phone,telegram}/sync/route.ts`
- `apps/web/src/components/hosted-onboarding/{hosted-invite-phone-auth.tsx,hosted-phone-auth-controller.ts,hosted-phone-auth-step-views.tsx}`
- `apps/web/src/lib/hosted-onboarding/{authentication-service.ts,billing-service.ts,hosted-member-store.ts,invite-service.ts,member-identity-service.ts}`
- Directly coupled tests under `apps/web/test/**`
- `agent-docs/exec-plans/active/{2026-04-24-hosted-onboarding-privacy-mutation-fixes.md,COORDINATION_LEDGER.md}`

## Out of scope

- Replacing Privy client-side SMS delivery with a server-owned SMS provider.
- Changing live Stripe Dashboard configuration.
- Redesigning hosted onboarding identity storage or historical invite state.

## Constraints

- Do not return full private phone numbers from unauthenticated invite-code routes.
- Keep manual phone entry as the proof-of-possession path while Privy SMS sending remains client-side.
- Preserve existing hosted webhook/session trust boundaries and no-store route behavior.
- Preserve unrelated dirty-tree work and avoid staging active rows owned by other lanes.

## Risks and mitigations

1. Risk: removing the stored-phone shortcut could strand users with a stale pending attempt from an older browser session.
   Mitigation: keep the existing pending-attempt flush effect and non-leaking confirm/abort endpoints.
2. Risk: suspension checks could block needed recovery flows.
   Mitigation: apply the guard only before live identity/contact/routing mutations in the hosted member state seams touched here.
3. Risk: narrowing reads could drop fields still required by messaging setup.
   Mitigation: select only `identity.phoneLookupKey` and Telegram routing fields used by `isHostedMemberMessagingSetupRequired`, with direct regression coverage through the completion path.

## Tasks

1. Register this lane in the coordination ledger and verify overlap.
2. Patch invite phone-code preparation to return only masked hints and rate-limit in-flight attempts.
3. Make invite phone auth use manual phone entry instead of the stored-number shortcut.
4. Add suspension guards before hosted identity/contact/routing mutations, including the member identity reconciliation transaction.
5. Narrow the Privy completion messaging read and billing checkout authenticated-member input.
6. Update focused tests and run required verification/audits.

## Verification

- Focused hosted onboarding, phone auth, settings sync, and billing tests.
- `bash scripts/workspace-verify.sh test:diff <touched files>`
- `pnpm typecheck`
- Required completion-workflow audit passes.

## Latest results

- PASS `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-onboarding-invite-send-code.test.ts apps/web/test/hosted-onboarding-member-service.test.ts apps/web/test/hosted-onboarding-routes.test.ts apps/web/test/hosted-phone-auth.test.ts apps/web/test/settings-phone-sync-route.test.ts apps/web/test/settings-telegram-sync-route.test.ts apps/web/test/hosted-onboarding-billing-checkout-route.test.ts apps/web/test/hosted-onboarding-billing-service.test.ts apps/web/test/hosted-onboarding-privy-service.test.ts apps/web/test/hosted-onboarding-member-store.test.ts apps/web/test/hosted-onboarding-member-identity-service.test.ts --no-coverage` (11 files, 173 tests).
- PASS `pnpm --dir apps/web typecheck`.
- PASS `pnpm --dir apps/web lint` with 17 existing warnings outside the touched diff.
- PASS `pnpm typecheck`.
- PASS `bash scripts/workspace-verify.sh test:diff <final hosted onboarding file set>`; this ran apps/web verify, including dev smoke, lint, full apps/web tests (179 files, 1087 tests), and Next build.
- PASS `git diff --check`.
- Required `coverage-write`, `frontend-review`, and `task-finish-review` passes completed; frontend and final-review findings were addressed.
Completed: 2026-04-24
