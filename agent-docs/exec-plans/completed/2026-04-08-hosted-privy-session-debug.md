# Hosted Privy Session Debug

## Goal

Instrument the hosted web Privy flow so local development can show exactly when Privy clears browser auth state during homepage login, join navigation, and refresh.

## Scope

- Add development-only diagnostics around `PrivyProvider` bootstrap, hosted onboarding token reads, and join-page auth-backed refreshes.
- Keep diagnostics redacted: booleans, counts, route, stage, and sanitized error metadata only.
- Add focused tests for the new debug helper and any changed client auth behavior.

## Constraints

- Do not log raw access tokens, identity tokens, refresh tokens, PATs, phone numbers, or environment variable values.
- Preserve adjacent hosted-web worktree edits and keep the diff narrow.
- Leave user-facing auth behavior unchanged; this pass is diagnostics only.

## Verification

- Focused hosted-web tests for the debug helper and client auth path.
- `pnpm --dir apps/web lint`
- `pnpm typecheck`
- `pnpm test:coverage`
Status: completed
Updated: 2026-04-08
Completed: 2026-04-08
