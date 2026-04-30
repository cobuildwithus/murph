# Simplify device sync control-plane surfaces

Status: completed
Created: 2026-04-30
Updated: 2026-04-30

## Goal

Make device provider/account commands stop leaking local daemon startup failures into hosted-capable or read-only user flows.

Success means:

- `device provider list` can list supported providers without starting `device-syncd`
- `device account list` does not start the managed local daemon by default
- local daemon credential and health failures stay scoped to explicit local daemon/sync/connect operations
- hosted agents can still issue hosted provider connect URLs when running in a hosted-capable environment
- hosted device connect/account authority stays owned by hosted web/runtime seams
- no hosted provider client secrets are forwarded into local agent, CLI, or daemon environments

## Current Root Cause

The immediate coupling is local and narrow:

- `packages/cli/src/device-services.ts` routes `listProviders` and `listAccounts` through a control-plane client.
- That client calls `ensureManagedDeviceSyncControlPlane`.
- Without an explicit target, the helper can start the managed local `device-syncd`.
- Local daemon startup correctly fails when local provider client credentials are absent.

Hosted WHOOP can still be configured and connected because hosted web/runtime owns a separate device control plane. The bug is that local CLI read-ish commands treat local daemon availability as global device truth.

## Revised Design Principle

Do not add a shared cross-runtime implementation facade yet.

Instead, split the surfaces that were accidentally collapsed:

1. Provider catalog: static supported-provider facts.
2. Local runtime availability: whether the local daemon/config can answer local control-plane queries.
3. Local control-plane accounts: token-backed accounts known to a local daemon.
4. Hosted control-plane authority: app-owned hosted connection/account/link behavior.
5. Landed wearable data: query-owned canonical/read-model data, not token-backed account state.

Each owner keeps its current authority boundary. The CLI composes the pieces it can safely see.

## Ownership Shape

- `packages/device-syncd`
  - owns provider manifests and local sync runtime behavior
  - should expose a pure, redacted provider catalog helper
  - should not require provider credentials or daemon startup for catalog reads
- `packages/operator-config`
  - owns local daemon lifecycle helpers and CLI-facing local daemon contracts
  - should provide a non-starting local viability/status probe
- `packages/cli`
  - composes provider catalog plus local availability/account results
  - should stop calling managed daemon startup from read-ish commands
- `apps/web`
  - remains the hosted device control-plane owner
  - keeps hosted provider credentials, Prisma-backed connection state, token/session behavior, and hosted connect links
- `packages/assistant-runtime` and `apps/cloudflare`
  - keep using the hosted runtime device-sync port
  - should not receive hosted provider client secrets
- `packages/query`
  - owns landed wearable/source-health reads
  - should not be forced into token-backed `device account` records

## Minimal Implementation Plan

1. Split provider catalog from configured runtime providers.
   - Add a pure catalog export from provider manifests/descriptors.
   - Return only redacted/static fields: provider key, label, capabilities, supported status, and non-secret metadata.
   - Do not include `createProvider`, `readConfig`, env values, client secrets, callback URLs, or webhook URLs in the static catalog.

2. Change `device provider list`.
   - Build providers from the pure catalog.
   - Attach local availability from local config inspection, not daemon startup.
   - Only include live local URLs when an explicit or already-running local control plane can honestly provide them.
   - Update the result contract so `baseUrl`, `callbackUrl`, and `webhookUrl` are not mandatory for catalog-only output.

3. Add a non-starting local control-plane probe.
   - Probe explicit `--base-url` / configured base URL without spawning the managed daemon.
   - Probe existing managed daemon state without creating or cleaning up state.
   - Return local availability metadata such as `not_configured`, `not_running`, `healthy`, `unhealthy`, or `explicit_unreachable`.

4. Change `device account list`.
   - Default behavior must not start the managed daemon.
   - If an explicit base URL is supplied, treat the command as local explicit and contact that target.
   - If an existing managed daemon is healthy, query local accounts.
   - Otherwise succeed with `accounts: []` plus local diagnostics instead of throwing daemon startup/config errors.
   - Do not mix landed wearable source-health rows into token-backed account rows.

5. Leave local mutations on the local daemon path.
   - `device connect`, `device reconcile`, `device disconnect`, local sync commands, and `device daemon *` can still start or require `device-syncd` when they are local operations.
   - `DEVICE_SYNC_PROVIDER_CONFIG_REQUIRED` remains appropriate there.

6. Keep hosted behavior where it already belongs.
   - Hosted connect remains through hosted web/runtime ports.
   - A hosted-capable agent must still be able to send a provider connect URL through the existing hosted web/runtime device-sync port.
   - Plain local CLI should not default to hosted connect until there is an explicit hosted session/pairing source.
   - No public `--runtime hosted|local|auto` flag in the first cleanup.

7. Clarify language.
   - Use "provider catalog" for static supported providers.
   - Use "local daemon accounts" for local token-backed daemon state.
   - Use "hosted device connection" for hosted app-owned auth/link behavior.
   - Use "landed wearable data" for query/read-model data.

## Contract Direction

The current CLI result contracts are local-daemon-shaped because they require fields such as `baseUrl` and live URL/provider account details.

The first contract change should introduce discriminated or optional sections:

```ts
interface DeviceProviderListResult {
  providers: DeviceProviderCatalogEntry[];
  local: DeviceLocalAvailability;
  localControlPlane?: DeviceLocalControlPlaneInfo;
}

interface DeviceAccountListResult {
  accounts: DeviceLocalAccountSummary[];
  local: DeviceLocalAvailability;
  localControlPlane?: DeviceLocalControlPlaneInfo;
}
```

If hosted account listing later becomes a CLI-visible concept, add a separate hosted section instead of forcing hosted or read-model data into the local account shape.

## Deferred Work

- No shared `DeviceAccessFacade` implementation below app/CLI packages yet.
- No public `--runtime hosted|local|auto` flag until hosted CLI session ownership is clear.
- No read-model-derived fake accounts in `device account list`.
- No hosted provider secrets or token bundles in local CLI/daemon environments.
- No merge of hosted token stores and local daemon stores.

## Error Semantics

Keep the error model smaller for this cleanup:

- Explicit local daemon startup can throw `DEVICE_SYNC_PROVIDER_CONFIG_REQUIRED`.
- Explicit local daemon/account mutation commands can throw daemon health/config errors.
- Catalog reads should succeed even when local is unavailable.
- Account list should prefer successful empty output plus local diagnostics over hard errors when no local control plane is available.

Do not add a broad hosted/local error taxonomy until hosted account/connect has a real public CLI surface.

## Verification Strategy

Implementation should prove:

- provider catalog read with no local credentials:
  - does not call daemon startup
  - returns supported providers
  - reports local availability as not configured
- account list with no local credentials:
  - does not call daemon startup
  - returns empty accounts plus diagnostics
  - does not wrap the result as daemon unhealthy
- explicit local daemon command with no credentials:
  - still fails with local provider configuration required
- explicit base URL:
  - is treated as local explicit and does not silently switch to hosted/read-model behavior
- healthy already-running local daemon:
  - still supports provider/account reads through the local control plane
- hosted connect flows:
  - hosted-capable agents can still produce connect URLs
  - continue using hosted web/runtime port behavior
  - continue not forwarding provider client secrets into child/user env

Negative tests should assert that `startManagedDeviceSyncDaemon` / `ensureManagedDeviceSyncControlPlane` is not reached for default provider/account list reads.

## Implementation Notes

- Added a redacted provider catalog helper that exposes static supported-provider facts without configured runtime provider construction.
- Changed default `device provider list` to return catalog output plus local daemon availability without starting `device-syncd`.
- Changed default `device account list` to use only explicit or already-healthy local control planes; otherwise it returns an empty account list plus diagnostics instead of daemon startup errors.
- Added a non-starting helper for reusing a healthy managed local daemon.
- Kept top-level `baseUrl` live-control-plane scoped for provider/account list output; catalog-only and no-daemon account output now carry the diagnostic URL under `local.baseUrl`.
- Preserved explicit base URL, connect, reconcile, disconnect, and daemon commands on the local control-plane path.
- Preserved hosted connect-link authority in the hosted web/runtime port path.

## Verification Results

- Passed: `pnpm typecheck`
- Passed: `pnpm --dir packages/device-syncd typecheck`
- Passed: `pnpm --dir packages/operator-config typecheck`
- Passed: `pnpm --dir packages/cli typecheck`
- Passed: `pnpm --dir packages/device-syncd exec vitest run test/provider-manifests.test.ts --config vitest.config.ts --no-coverage`
- Passed: `pnpm --dir packages/operator-config exec vitest run test/device-daemon-runtime.test.ts --config vitest.config.ts --no-coverage`
- Passed: `pnpm --dir packages/cli exec vitest run test/device-cli.test.ts test/device-daemon.test.ts --config vitest.config.ts --no-coverage`
- Passed: `pnpm --dir packages/device-syncd test:coverage`
- Passed: `pnpm --dir packages/operator-config test:coverage`
- Passed: `pnpm --dir packages/cli verify:coverage`
- Passed after review repairs: `pnpm --dir packages/cli exec vitest run test/device-cli.test.ts test/device-daemon.test.ts --config vitest.config.ts --no-coverage`
- Passed after review repairs: `pnpm --dir packages/operator-config exec vitest run test/device-daemon-runtime.test.ts --config vitest.config.ts --no-coverage`
- Passed after review repairs: `pnpm --dir packages/cli verify:coverage`
- Passed after review repairs: `pnpm --dir packages/device-syncd test:coverage`
- Passed after review repairs: `pnpm --dir packages/operator-config test:coverage`
- Passed after review repairs: `pnpm typecheck`
- Red for unrelated hosted-web dirty work after review repairs: `bash scripts/workspace-verify.sh test:diff agent-docs/exec-plans/active/2026-04-30-device-sync-control-plane-simplification.md packages/device-syncd/src/config/provider-manifests.ts packages/device-syncd/src/config.ts packages/device-syncd/src/index.ts packages/device-syncd/test/provider-manifests.test.ts packages/operator-config/src/device-daemon.ts packages/operator-config/src/device-cli-contracts.ts packages/operator-config/test/device-daemon-runtime.test.ts packages/cli/src/device-services.ts packages/cli/src/commands/device.ts packages/cli/test/device-cli.test.ts packages/cli/test/device-daemon.test.ts packages/cli/config.schema.json`
  - Failing target was `apps/web verify`, specifically unrelated dirty hosted-web lint/test failures in `apps/web/src/components/homepage/site-footer.tsx`, `apps/web/src/components/hosted-onboarding/join-invite-stage-panels.tsx`, `apps/web/test/join-invite-client.test.ts`, `apps/web/test/layout.test.ts`, and `apps/web/test/page.test.ts`.

## Stress Review Findings Incorporated

Four GPT-5.5 high review passes converged on these changes:

- remove the shared implementation facade from the first plan
- defer public runtime selection flags
- split static provider catalog output from live local daemon descriptors
- make `baseUrl`, callback URL, and webhook URL optional or availability-scoped
- keep read-model wearable source data out of token-backed account records
- add a non-mutating local viability probe for default read-ish commands
- preserve hosted web/runtime as the hosted authority boundary
- preserve hosted agent connect-link behavior as a first-class hosted capability

Required completion review findings incorporated:

- Preserved daemon conflict/unhealthy status messages instead of replacing them with provider-credential parse errors.
- Removed catalog-only/no-daemon top-level `baseUrl` so static catalog output is not mistaken for a reachable local control plane.
- Marked providers returned from a live local control plane as locally configured by that daemon instead of by the current shell env.
- Neutralized shared device `--base-url` help text so read-only list commands do not imply daemon startup.
- Added direct proof for default provider/account list reuse of a healthy managed daemon without an explicit base URL.
Completed: 2026-04-30
