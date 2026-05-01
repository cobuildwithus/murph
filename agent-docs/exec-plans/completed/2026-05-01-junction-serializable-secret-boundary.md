# Junction Serializable Secret Boundary

Status: completed
Created: 2026-05-01
Updated: 2026-05-01

## Goal

Disallow Junction provider-owned API/HMAC/webhook secrets from serializable device-sync runtime config.

Success criteria:

- `JunctionDeviceSyncProviderConfig.apiKey`, `clientUserIdSecret`, and `webhookSecret` are not part of `SerializableConfiguredDeviceSyncProviderConfigByKey["junction"]`.
- The Junction provider manifest does not copy those fields in `cloneSerializableConfiguredDeviceSyncProviderConfigs`.
- `parseSerializableConfiguredDeviceSyncProviderConfigs` rejects all three fields with clear provider-owned secret errors.
- Focused device-syncd coverage and typecheck are run or blockers are recorded.

## Constraints

- Preserve overlapping active Junction and hosted-runtime work in this checkout.
- Do not move Junction runtime secrets into serialized provider config; hosted should use env/secret channels.
- Keep the change scoped to the existing manifest/type/test seam.

## Current State

The architecture docs already describe hosted raw provider credentials as Worker secrets or encrypted runner-secret blobs, not serializable provider config. Current Junction manifest/test state still serializes `apiKey` and `clientUserIdSecret`.

Completed state:

- Junction API/HMAC/webhook secrets are omitted from the serializable type and disallowed by the manifest parser.
- Serializable runtime config cloning reparses and rejects injected Junction secrets instead of silently stripping them.
- Hosted maintenance does not instantiate Junction from serializable hints; future hosted Junction polling needs an explicit secret-hydration seam.
- Focused tests passed. Package/root verification remains blocked by unrelated overlapping dirty work recorded in handoff.

## Verification Plan

- Focused provider manifest test for serializable config.
- `pnpm --dir packages/device-syncd test:coverage` or a truthful focused fallback if unrelated dirty work blocks package coverage.
- `pnpm typecheck` unless blocked by unrelated active work.

## Working Set

- `packages/device-syncd/src/config/provider-types.ts`
- `packages/device-syncd/src/config/provider-manifests.ts`
- `packages/device-syncd/src/config/connect-targets.ts`
- `packages/device-syncd/src/config/runtime-config.ts`
- `packages/assistant-runtime/src/hosted-runtime/maintenance.ts`
- `packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts`
- `packages/device-syncd/test/provider-manifests.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Completed: 2026-05-01
