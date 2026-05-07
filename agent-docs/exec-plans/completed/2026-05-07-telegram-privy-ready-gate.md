# Hosted Telegram Privy Ready Gate

## Goal

Stop the settings Telegram link dialog from calling Privy account-linking before the Privy client has initialized and confirmed an authenticated Privy session.

## Scope

- `apps/web/src/components/settings/hosted-telegram-card-settings.tsx`
- Focused hosted settings tests for Telegram linking readiness.

## Constraints

- Preserve existing hosted app-session auth boundaries.
- Do not expose identifiers, secrets, or raw provider payloads.
- Do not alter Telegram sync API semantics.
- Preserve unrelated dirty worktree edits.

## Verification

- Focused hosted-web test coverage for the Telegram settings component.
- Required app/web scoped verification or documented blocker.
- Required completion audits for auth/session and user-facing settings UI.
Status: completed
Updated: 2026-05-07
Completed: 2026-05-07
