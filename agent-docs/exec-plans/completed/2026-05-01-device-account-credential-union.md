# Device account credential union

Status: completed
Created: 2026-05-01
Updated: 2026-05-01

## Goal

Remove the empty-string token sentinel from device-sync account hydration and push account credentials into explicit unions so provider-config accounts cannot accidentally look like OAuth token accounts.

## Scope

In scope:

- `StoredDeviceSyncAccount` and `DeviceSyncAccount` credential shape.
- SQLite row-to-account mapping and hosted account hydration token-preservation logic.
- Service decryption/refresh/revoke paths and OAuth provider helper call sites.
- Focused device-syncd and hosted-runtime tests that assert credential behavior.

Out of scope:

- Changing hosted Postgres schema or public API account response shape.
- Changing provider connection flows beyond adapting them to the credential union.
- Broader Junction polling/source projection behavior.

## Decisions

- Store raw database token columns as `null` when token material is absent.
- Do not expose top-level decrypted or encrypted token strings on account types.
- OAuth-only provider paths must read tokens through a helper that validates `credential.kind === "oauth_tokens"`.
- Provider-config and no-credential accounts preserve credential metadata without token fields.

## State

Now:

- Device-sync account types now expose nested credential unions instead of top-level token strings.
- Store mapping, hosted hydration, setup-failure, disconnect, OAuth refresh, revoke, hosted runtime projection, and hosted-web stored-account paths use credential-kind checks.
- Empty token sentinel usage remains only in schema migration cleanup for legacy rows.
- Active credential primitive and Junction lanes overlap these files, so no scoped commit should be created from this checkout.

Next:

- Close this plan without committing because overlapping dirty work is present.

## Verification

- `pnpm --dir packages/device-syncd typecheck`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir packages/device-syncd exec vitest run test/store.test.ts --config vitest.config.ts --no-coverage -t "credential|tokens|hosted hydration|setup failures|updates existing|split connection|legacy"`
- `pnpm --dir packages/device-syncd exec vitest run test/service.test.ts test/shared-oauth.test.ts test/public-ingress.test.ts test/junction-provider.test.ts test/garmin-provider.test.ts test/whoop-provider.test.ts test/oura-provider.test.ts test/strava-provider.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-device-sync-runtime.test.ts --config vitest.config.ts --no-coverage`
- `pnpm exec vitest run apps/web/test/device-sync-internal-runtime.test.ts apps/web/test/device-sync-hosted-runtime-authority.test.ts --config apps/web/vitest.workspace.ts --no-coverage`
- `pnpm test:smoke`
- `git diff --check`

Known unrelated blockers:

- Full `pnpm typecheck` fails in `packages/vault-usecases` on missing `@murphai/query` module/type declarations and pre-existing `unknown[]` list-result typing errors.
- Full `packages/device-syncd` focused run including all of `test/store.test.ts` has one unrelated webhook trace retention failure because `completeWebhookTrace` prunes the April 1, 2026 processed row under the current May 1, 2026 date.

## Working Set

```txt
packages/device-syncd/src/types.ts
packages/device-syncd/src/store/accounts.ts
packages/device-syncd/src/store/hosted-account-hydration.ts
packages/device-syncd/src/service.ts
packages/device-syncd/src/providers/shared-oauth.ts
packages/device-syncd/src/providers/{garmin,oura,strava,whoop}.ts
packages/assistant-runtime/src/hosted-device-sync-runtime.ts
apps/web/src/lib/device-sync/agent-session-token-bundle.ts
apps/web/src/lib/device-sync/hosted-runtime-authority.ts
apps/web/src/lib/device-sync/internal-runtime.ts
apps/web/src/lib/device-sync/prisma-store/connections.ts
apps/web/src/lib/device-sync/wake-service.ts
packages/device-syncd/test/{store,service,junction-provider,shared-oauth}.test.ts
packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts
apps/web/test/{device-sync-internal-runtime,device-sync-hosted-runtime-authority}.test.ts
```
Completed: 2026-05-01
