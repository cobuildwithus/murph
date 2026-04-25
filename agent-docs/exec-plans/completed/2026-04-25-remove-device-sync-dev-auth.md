# Remove Device-Sync Dev Auth Fallback

## Goal

Remove the hosted device-sync development user fallback so browser-facing hosted routes require a signed hosted-user assertion in every deployed/runtime mode.

## Scope

- Remove `DEVICE_SYNC_DEV_USER_*` runtime config from hosted device-sync env parsing.
- Remove the unauthenticated development fallback from `requireAuthenticatedHostedUser`.
- Update direct hosted-web tests and docs/examples that mention the fallback.
- Confirm local assistant/device-sync paths do not rely on the removed env surface.

## Constraints

- Preserve the signed assertion auth path and nonce replay protection.
- Preserve unrelated dirty work and active ledger rows.
- Do not log or fixture real member ids, email addresses, device-provider tokens, local paths, or secrets.
- Keep local assistant paths on their existing local daemon or signed hosted callback authority, without adding a replacement bypass.

## Verification Plan

- Focused hosted-web auth/env tests for the changed surface.
- Stale-reference search for removed env names and fallback source labels.
- `git diff --check` on touched files.
- Repo-required typecheck/app verification if not blocked by unrelated branch state.

## State

- Runtime fallback removed.
- Env reader now rejects stale development auth variables instead of ignoring them.
- `.env.example` and hosted-web README no longer document a development user bypass.
- Focused auth/env Vitest passed.
- Scoped `apps/web` verifier passed dev smoke, lint, and hosted-web tests, then failed at unrelated TypeScript errors in the active Linq typing diagnostic file.
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
