# Hosted provider-config hydration

Status: active
Created: 2026-05-01
Updated: 2026-05-01

## Goal

Fix hosted stored-account hydration so tokenless `provider_config` and `none` device-sync connections hydrate as executable accounts instead of disappearing behind the OAuth token-bundle path.

Success criteria:

- `HostedStoredDeviceSyncAccount` allows null token-version fields for non-token credentials.
- `buildStoredConnectionAccount()` returns credential-union accounts for `oauth_tokens`, `provider_config`, and `none`.
- The runtime account composer is explicitly OAuth-only or credential-union aware so Junction/provider-config callers cannot use it accidentally.
- Focused hosted-web tests prove provider-config stored hydration and OAuth revoke composition.

## Scope

In scope:

- `apps/web/src/lib/device-sync/prisma-store/connection-records.ts`
- `apps/web/src/lib/device-sync/prisma-store/connections.ts`
- `apps/web/src/lib/device-sync/internal-runtime.ts`
- `apps/web/src/lib/device-sync/wake-service.ts`
- `apps/web/src/lib/device-sync/agent-session-token-bundle.ts`
- `apps/web/src/lib/hosted-privacy/account-data-service.ts`
- Direct focused hosted-web tests.

Out of scope:

- Prisma schema or migration changes.
- Device provider implementation changes.
- Hosted runtime wire-contract changes already covered by the completed credential-union plan.

## Decisions

- Keep OAuth token refresh/export fail-closed by returning token bundles only when the hydrated account credential is OAuth and token metadata is present.
- Rename the existing composer to an OAuth-specific helper because its current only production caller is provider revocation, which already gates on stored OAuth token material.

## State

Now:

- Implementation and security-review follow-up fixes are in place.
- `buildStoredConnectionAccount()` hydrates OAuth, provider-config, and none credential shapes.
- Account deletion provider revocation is gated on an OAuth stored token bundle.
- Provider-config credential metadata drops raw account/profile ids unless hashed or blind-indexed.
- Focused tests, direct ESLint, diff check, and hosted-web typecheck pass.
- Scoped `test:diff` reaches `apps/web verify` and remains red on unrelated hosted-onboarding webhook tests.

Next:

- Run final completion review and close/commit if safe.

## Working Set

```txt
apps/web/src/lib/device-sync/prisma-store/connection-records.ts
apps/web/src/lib/device-sync/prisma-store/connections.ts
apps/web/src/lib/device-sync/internal-runtime.ts
apps/web/src/lib/device-sync/wake-service.ts
apps/web/src/lib/device-sync/agent-session-token-bundle.ts
apps/web/src/lib/hosted-privacy/account-data-service.ts
apps/web/test/prisma-store-oauth-connection.test.ts
apps/web/test/device-sync-internal-runtime.test.ts
apps/web/test/hosted-account-data-service.test.ts
agent-docs/exec-plans/active/2026-05-01-hosted-provider-config-hydration.md
agent-docs/exec-plans/active/COORDINATION_LEDGER.md
```
