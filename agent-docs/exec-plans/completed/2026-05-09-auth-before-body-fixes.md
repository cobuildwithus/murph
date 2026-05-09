# Auth-Before-Body Fixes

## Goal

Fix two DeepSec-reported auth/body ordering issues without broadening route authority:

- device-sync agent pairing must authenticate the hosted-user assertion before parsing the request body
- hosted email reply-alias registration must bound the callback body before signature verification and parse the same bounded payload after auth

## Scope

- `apps/web/app/api/device-sync/agents/pair/route.ts`
- `apps/web/app/api/internal/hosted-execution/email/register-reply-alias/route.ts`
- focused route tests for the two regressions

## Constraints

- Keep the changes route-local and composable.
- Preserve existing nonce consumption in `requireAuthenticatedHostedUser` and `requireHostedCloudflareCallbackRequest`.
- Do not touch the remaining Privy session replay or Cloudflare callback nonce-consumption design issues in this plan.
- Preserve unrelated working-tree edits.

## Verification

- Focused `apps/web` tests for the touched routes
- Scoped workspace verification if it truthfully covers the touched files
- Required security/privacy and final completion review for auth-boundary changes

## State

- Status: active
- Created: 2026-05-09
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
