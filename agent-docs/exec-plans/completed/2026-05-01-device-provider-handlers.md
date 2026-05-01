# Device provider handler interface cleanup

Status: completed
Created: 2026-05-01

## Goal

Make `DeviceSyncProvider` match the connection/webhook/job primitives so non-OAuth providers such as Junction do not need OAuth thrower methods.

Success criteria:

- `DeviceSyncProvider` exposes optional `connectionHandler`, `webhookHandler`, and `jobExecutor` slots.
- Legacy OAuth-shaped `buildConnectUrl`, `exchangeAuthorizationCode`, and `refreshTokens` methods are optional compatibility methods.
- Existing OAuth providers are wrapped through a compatibility adapter that populates the handler slots.
- Junction provides only generic handlers for connection, webhook, and jobs, with no OAuth thrower/stub methods.
- Focused device-syncd tests prove Junction still connects, callbacks, webhooks, and jobs work.

## Constraints

- Preserve active Junction origin-parser edits and unrelated dirty checkout work.
- Do not print or fixture raw provider payloads, tokens, local paths, or direct identifiers.
- Keep provider-config credentials unsupported for token refresh.

## Working Set

```txt
packages/device-syncd/src/types.ts
packages/device-syncd/src/public-ingress.ts
packages/device-syncd/src/service.ts
packages/device-syncd/src/providers/shared-oauth.ts
packages/device-syncd/src/providers/{garmin,oura,strava,whoop,junction}.ts
packages/device-syncd/test/** focused provider/ingress/service tests if needed
agent-docs/exec-plans/active/2026-05-01-device-provider-handlers.md
agent-docs/exec-plans/active/COORDINATION_LEDGER.md
```

## Verification

Passed:

- `pnpm --dir packages/device-syncd typecheck`
- `git diff --check`
- `pnpm --dir packages/device-syncd exec vitest run test/junction-provider.test.ts test/public-ingress.test.ts test/service.test.ts test/provider-descriptor-integration.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir apps/web typecheck`
- `pnpm exec vitest run apps/web/test/agent-session-service.test.ts --config apps/web/vitest.config.ts --no-coverage`
- `pnpm test:smoke`

Blocked by unrelated active work:

- `pnpm --dir packages/device-syncd test` fails in `test/store.test.ts` webhook trace retention and `test/config.test.ts` Junction connect-target config setup.
- `pnpm typecheck` fails in `packages/cli` connect-target contract imports and `sourceProviderSlug` option typing.

Commit status:

- Scoped commit created for the remaining handler-interface files after overlapping active work landed separately.
Updated: 2026-05-01
Completed: 2026-05-01
