# Greenfield legacy-removal audit - 2026-03-31

Assumptions applied for this pass:

- there are no live deployments or external users to preserve
- local config, state, caches, and setup can be blown away and recreated
- backwards compatibility survives only where the current architecture still actively depends on it

Status note as of 2026-04-06:

- the items that were under `remove now` in this audit have landed
- the former `registryCompatibilitySelfIds` follow-up also landed; `projectRegistryEntity` now derives `relatedIds` directly from normalized links
- the remaining `keep for now` entries below are preserved as the still-useful rationale for intentionally supported tolerance paths

## remove now at audit time

All items in this section have since landed.

### 1. Gateway opaque-id v1 envelope readers

- **Files / symbols:** `packages/gateway-core/src/opaque-ids.ts` - `GatewayOpaqueEnvelope.routeKey`, `GatewayOpaqueEnvelope.version`, `decodeGatewayOpaqueId`, `readGatewayRouteTokenField`; tests in `packages/cli/test/gateway-local-service.test.ts` and `apps/cloudflare/test/user-runner.test.ts`
- **Compatibility behavior removed:** readers accepted legacy `version: 1` opaque ids that stored raw `routeKey` instead of the current `routeToken`.
- **Why a hard cut is safe here:** current writers already emit only `version: 2` `routeToken` envelopes. Fresh session/message/attachment ids come from `createGatewayConversationSessionKey`, `createGatewayCaptureMessageId`, `createGatewayOutboxMessageId`, and `createGatewayAttachmentId`, and current call sites in `packages/gateway-core/src/store/source-sync.ts` and `packages/gateway-core/src/send.ts` route through those helpers. The only remaining v1 constructors were test fixtures.
- **Exactly what can be removed:** reject non-`version: 2` ids; require `routeToken` on read; delete the compatibility-only tests that asserted legacy session keys still resolved, and move hosted runner fixtures onto the canonical helper.
- **Follow-on cleanup:** clear any local gateway snapshots, outbox projections, or hosted runner payload fixtures that still carry v1 `gwcs_`/`gwcm_`/`gwca_` ids.
- **Concrete risk if removed incorrectly:** stale local snapshots or queued intents with v1 ids will stop resolving conversations/messages until that local state is rebuilt.

### 2. Workout-format scan tolerance for stale pre-canonical markdown

- **Files / symbols:** `packages/cli/src/usecases/workout-format.ts` - `loadWorkoutFormats`, removed `isLegacyWorkoutFormatCompatibilityError`; tests in `packages/cli/test/cli-expansion-workout.test.ts`
- **Compatibility behavior removed:** directory scans silently skipped old workout-format docs missing canonical fields like `workoutFormatId` or `activityType`, so newer commands could keep working around stale local markdown.
- **Why a hard cut is safe here:** the canonical writer path already requires the full current shape (`packages/core/src/bank/workout-formats.ts` - `parseWorkoutFormatRecord`, `upsertWorkoutFormat`), and the CLI save path persists that shape before later reads reuse it. The skipped shape only protects ad hoc historical local markdown.
- **Exactly what can be removed:** stop swallowing parse failures while scanning `bank/workout-formats/**/*.md`; remove the legacy-specific scan test and replace it with a hard-fail expectation.
- **Follow-on cleanup:** delete malformed local workout-format docs or recreate them through the current save command.
- **Concrete risk if removed incorrectly:** one stale workout-format file can now block `workout format list`, `show`, or `log` until the file is removed or rewritten.

### 3. CLI-shaped inbox/vault service aliases and the `./vault-cli-services` shim

- **Files / symbols:** `packages/assistant-core/src/inbox-services.ts`, `packages/assistant-core/src/inbox-app/service.ts`, `packages/assistant-core/src/inbox-app/types.ts`, `packages/assistant-core/src/usecases/integrated-services.ts`, `packages/assistant-core/src/usecases/types.ts`, `packages/cli/package.json`, `tsconfig.base.json`, and `packages/cli/scripts/verify-package-shape.ts`
- **Compatibility behavior removed:** the repo still carried CLI-shaped compatibility names (`createIntegratedInboxCliServices`, `InboxCliServices`, `createIntegratedVaultCliServices`, `createUnwiredVaultCliServices`, `VaultCliServices`) plus the `murph/vault-cli-services` TypeScript path alias even though current code had already standardized on the canonical service names.
- **Why a hard cut is safe here:** repo-wide source search shows no current runtime import sites for those compatibility names; active code imports `createIntegratedInboxServices`, `InboxServices`, `createIntegratedVaultServices`, `createUnwiredVaultServices`, and `VaultServices` instead.
- **Exactly what can be removed:** drop the alias exports/types from the owner package, remove the matching `murph/vault-cli-services` TypeScript path alias, and tighten the package-shape verification so the aliases do not reappear.
- **Follow-on cleanup:** update any unpublished local scripts or notebooks that still import the removed alias names.
- **Concrete risk if removed incorrectly:** hidden downstream tooling that still imports the alias names will fail to compile or load until it switches to the canonical exports.

## remove after a small follow-up at audit time

This follow-up has also since landed.

### 1. Registry self-id compatibility stuffing into `relatedIds`

- **Status (2026-04-06):** landed; current `projectRegistryEntity` no longer appends self ids to `relatedIds`.

- **Files / symbols:** `packages/query/src/health/projectors/registry.ts` - `registryCompatibilitySelfIds`, `projectRegistryEntity`; tests in `packages/query/test/health-registry-definitions.test.ts` and `packages/query/test/health-tail.test.ts`
- **Compatibility behavior involved:** goal/condition/protocol projections still stuff their own scalar ids back into `relatedIds` so older link-less expectations continue to round-trip.
- **Why this is not a same-patch cut:** current query projections, round-trip tests, and export-pack expectations still assert the self-id appears in `relatedIds`. Removing it cleanly needs one coordinated follow-up across projection tests and any consumers that currently treat `relatedIds` as both relation targets and a self-lookup convenience list.
- **What to remove after the follow-up:** drop `registryCompatibilitySelfIds`, stop appending self ids to `relatedIds`, and update projection/export tests to rely on `entityId`/`lookupIds` plus normalized links instead.
- **Concrete risk if removed incorrectly:** subtle search/export/timeline linkage drift where consumers stop seeing expected ids in `relatedIds` and silently change ordering or filter behavior.

## keep for now

### 1. Current-profile fallback from the latest snapshot

- **Files / symbols:** `packages/query/src/health/current-profile-resolution.ts`, `packages/query/src/health/entity-slices.ts`, related coverage in `packages/query/test/health-tail.test.ts`
- **Why it still appears required:** this looks like stale-read tolerance, but the current health architecture still intentionally treats `bank/profile/current.md` as a materialized view over snapshot state. The read path is supposed to keep working when that page is stale, missing, or malformed.
- **Concrete risk if removed incorrectly:** profile reads, export packs, and overview flows can lose the current profile entirely whenever the materialized markdown lags behind the latest snapshot.

### 2. Vault metadata additive repair path

- **Files / symbols:** `packages/core/src/vault-metadata.ts` - `applyVaultMetadataCompatibilityDefaults`; `packages/core/src/vault.ts` - `loadVault`, `repairVault`; `packages/assistant-core/src/text/shared.ts`
- **Why it still appears required:** this is still part of the supported vault scaffold contract and operator workflow, not dead migration glue. Current validation intentionally surfaces additive drift as repairable rather than fatal.
- **Concrete risk if removed incorrectly:** existing vaults and fixtures with additive scaffold drift would fail to load or validate cleanly, and the supported `vault repair` flow would disappear.

### 3. Assistant doctor secret-header repair

- **Files / symbols:** `packages/cli/src/assistant/doctor-security.ts`; `packages/cli/src/commands/assistant.ts`
- **Why it still appears required:** even though it reads like migration scaffolding, it still protects a live trust boundary by moving secret-bearing provider headers out of session JSON into private sidecars and by tightening file permissions.
- **Concrete risk if removed incorrectly:** operators lose the supported repair path for leaked inline headers or permissive assistant-state modes, leaving sensitive material in the wrong files.

### 4. Hosted bundle keyring and read-time rekey support

- **Files / symbols:** `apps/cloudflare/src/crypto.ts` - `readEncryptedR2Payload`, `migrateEncryptedPayloadIfNeeded`; tests in `apps/cloudflare/test/user-runner.test.ts`
- **Why it still appears required:** this is part of the current encrypted-bundle rotation contract rather than obsolete local-state migration glue. The current worker still needs to read older key ids during key rotation.
- **Concrete risk if removed incorrectly:** key rotation can strand older encrypted bundle objects or turn successful reads into avoidable decryption failures.

### 5. `normalizeGatewayRouteToken(routeKeyOrToken)` input flexibility

- **Files / symbols:** `packages/gateway-core/src/opaque-ids.ts` - `normalizeGatewayRouteToken`; current call sites in `packages/gateway-core/src/store/source-sync.ts` and `packages/gateway-core/src/send.ts`
- **Why it still appears required:** the parameter name looks like compatibility leftover, but current writers still pass both raw route keys and already-derived route tokens. The dead branch was the read-time `routeKey` fallback, not the write-time helper flexibility.
- **Concrete risk if removed incorrectly:** current send/source-sync call sites could generate mismatched ids if the helper stopped normalizing both active input shapes.
