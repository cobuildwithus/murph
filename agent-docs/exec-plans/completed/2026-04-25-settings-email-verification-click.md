# Settings Email Verification Click

## Goal

Fix the hosted settings email verification flow so clicking the settings-page send/verify controls invokes the Privy email update SDK calls even when React controlled input state lags behind the live input value.

## Scope

- `apps/web/src/components/settings/hosted-email-settings*.tsx`
- `apps/web/test/settings-email-settings.test.ts`
- This plan and its coordination-ledger row

## Constraints

- Keep code delivery delegated to Privy; do not add a Murph email sender.
- Do not weaken the server-side verified-email sync route.
- Preserve existing phone, Telegram, and homepage email auth behavior.

## Verification

- Focused hosted-web settings email tests.
- Typecheck or scoped equivalent if repo-wide checks are blocked by unrelated active work.
- Required completion audit passes for user-facing auth/settings UI.
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
