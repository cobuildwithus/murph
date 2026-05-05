# Junction hosted runtime executability

Status: completed
Created: 2026-05-05
Updated: 2026-05-05

## Goal

- Make hosted runtime device-sync execution able to instantiate Junction from an explicit platform-owned runtime secret channel.
- Prevent dirty device-sync revisions from being acknowledged into unexecutable local jobs when their provider cannot run in the hosted runtime.
- Keep the storm fix intact: webhook freshness remains trace/audit plus dirty state and best-effort runner wake, not mailbox/workflow fanout.

## Why

- Hosted Junction connect is brokered by the web/control-plane path, but dirty data drain still runs inside the hosted runtime provider registry.
- Serializable hosted runtime provider config intentionally excludes Junction provider-owned API/HMAC secrets. Without an explicit runtime secret channel, Junction dirty rows can remain pending forever or be acknowledged into jobs that fail with an unregistered provider.

## Scope

- Platform env allowlist for Junction runtime execution config.
- Hosted runtime provider construction from platform env.
- Dirty-state runtime handoff guard/logging and bounded fetch limit.
- Focused assistant-runtime and Cloudflare runner env tests.

## Out of scope

- Reintroducing device-sync webhook mailbox/workflow fanout.
- Persisting Junction provider-owned secrets in user-visible or serializable runtime config.
- Removing legacy wake-hint fields before old device-sync mailbox items are known drained.
- Adding Postgres partial indexes for dirty rows.

## Constraints

- Junction API and HMAC secrets must stay platform-owned and must not be forwarded as user env or serialized in `resolvedConfig.deviceSync.providerConfigs`.
- Webhook ingress remains durable-acceptance first; missed wake recovery stays internal.
- Preserve unrelated dirty-tree edits and active ledger rows.

## Tasks

1. Register the work and inspect the runtime provider/config seams.
2. Add Junction runtime platform env hydration while keeping serializable config secret-free.
3. Add dirty-state guards for missing/mismatched/unregistered providers and fetch up to ten rows per pass.
4. Add focused tests for Junction hydration, no-secret forwarding, dirty skip behavior, and fetch limit.
5. Run focused verification, inspect the scoped diff for sensitive data, commit, and close this plan.

## Verification

- `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-maintenance.test.ts test/hosted-device-sync-runtime.test.ts test/hosted-runtime-environment.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir apps/cloudflare exec vitest run test/runner-env.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir apps/cloudflare typecheck`

## Current results

- Implemented:
  - Junction runtime execution config is hydrated from platform env when the serializable runtime config says Junction is enabled.
  - Junction provider-owned runtime secrets remain out of forwarded env, user env, and serializable `resolvedConfig.deviceSync.providerConfigs`.
  - Dirty-state handoff fetches up to ten rows and processes the first executable row.
  - Dirty rows without a mapped connection/local account or registered provider are left unacked and logged with redacted skip reason metadata.
  - Device-sync runtime skips with `dirty_state.device_sync_config_missing` when device-sync config exists but no executable provider registry can be built.
- Green verification:
  - `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-maintenance.test.ts test/hosted-device-sync-runtime.test.ts test/hosted-runtime-environment.test.ts test/hosted-runtime-events-coverage.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm exec vitest run apps/cloudflare/test/runner-env.test.ts --config apps/cloudflare/vitest.config.ts --no-coverage`
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `pnpm --dir apps/cloudflare typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-device-sync-runtime.ts packages/assistant-runtime/src/hosted-env-categories.ts packages/assistant-runtime/src/hosted-runtime/maintenance.ts packages/assistant-runtime/src/hosted-runtime/events.ts packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts packages/assistant-runtime/test/hosted-runtime-environment.test.ts packages/assistant-runtime/test/hosted-runtime-events-coverage.test.ts packages/assistant-runtime/test/hosted-runtime-events.test.ts packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts apps/cloudflare/test/runner-env.test.ts`
Completed: 2026-05-05
