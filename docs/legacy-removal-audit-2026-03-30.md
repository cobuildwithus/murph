# Greenfield legacy-removal audit - 2026-03-30

Assumptions applied for this pass:

- there are no live deployments or external users to preserve
- local config, state, caches, and setup can be blown away and recreated
- backwards compatibility survives only where the current architecture still actively depends on it

## remove now

### 1. Canonical-only Linq recipient binding lookups and writes

- **Files / symbols:** `apps/web/src/lib/linq/prisma-store.ts` - `PrismaLinqControlPlaneStore.listBindingsForUser`, `getBindingByRecipientPhone`, `upsertBinding`, removed helpers `findBindingsByCanonicalRecipientPhone`, `buildRecipientPhoneLookupCandidates`, `choosePreferredBindingRecord`, and `collapsePreferredBindings`; `apps/web/prisma/schema.prisma` - `model LinqRecipientBinding`; `apps/web/test/prisma-store-linq-binding.test.ts`
- **Compatibility behavior removed:** the control-plane store scanned for plusless or punctuation-formatted legacy rows, collapsed same-user duplicate rows, and preferred canonical rows only to preserve older local Postgres contents.
- **Why a hard cut is safe here:** current writes already canonicalize with `normalizeCanonicalRecipientPhone(...)`, and the current Prisma model enforces `@@unique([recipientPhone])`. In a greenfield repo with disposable local state, there is no real cutover risk worth preserving for historical phone formatting variants.
- **Exactly what can be removed:** use a canonical unique lookup/update path only; stop scanning `findMany(...)` for legacy phone variants; delete duplicate-collapse helpers and the legacy-binding tests that existed only to justify those compatibility branches.
- **Follow-on cleanup:** reset local Postgres or delete any non-canonical `linq_recipient_binding.recipient_phone` rows before expecting old dev data to resolve.
- **Concrete risk if removed incorrectly:** stale local databases that still contain non-canonical phone formats will stop resolving webhook ownership or browser lookups until they are reset or repaired.

### 2. Hosted side-effect journal support for legacy effect-only records

- **Files / symbols:** `apps/cloudflare/src/outbox-delivery-journal.ts` - `createHostedExecutionSideEffectJournalStore.read`, `createHostedExecutionSideEffectJournalStore.write`, `readRecordAtKey`, new `readAliasRecordKeyAtKey`; `apps/cloudflare/test/outbox-delivery-journal.test.ts`
- **Compatibility behavior removed:** the journal treated `transient/side-effects/by-effect/**` direct record payloads as valid canonical state and opportunistically rewrote them into the newer fingerprint-plus-alias layout.
- **Why a hard cut is safe here:** the current writer already persists canonical records at the fingerprint key and writes an alias at the effect key. The read API already receives the fingerprint in its query shape, so preserving old effect-only R2 records is only about historical local bucket state.
- **Exactly what can be removed:** require the effect-key object to be an alias only; dedupe writes against the fingerprint key only; delete the legacy repair test and replace it with a hard-cut expectation.
- **Follow-on cleanup:** clear local dev buckets or let fresh writes recreate the canonical alias entries.
- **Concrete risk if removed incorrectly:** a retained local bucket with only effect-key records will no longer suppress duplicate deliveries or answer read-after-write lookups until the state is recreated.

### 3. Dead hosted-share base URL env alias

- **Files / symbols:** `packages/hosted-execution/src/env.ts` - `readHostedExecutionWebControlPlaneEnvironment`
- **Compatibility behavior removed:** the env reader accepted undocumented `HOSTED_SHARE_BASE_URL` ahead of `HOSTED_SHARE_API_BASE_URL`.
- **Why a hard cut is safe here:** current repo contracts and consumers use `HOSTED_SHARE_API_BASE_URL` (`apps/cloudflare/src/worker-contracts.ts`, `apps/cloudflare/src/runner-outbound.ts`, `packages/cli/src/assistant-cli-tools.ts`). `HOSTED_SHARE_BASE_URL` appears only in this reader, so it is an orphaned alias rather than a current contract.
- **Exactly what can be removed:** stop reading `HOSTED_SHARE_BASE_URL` and rely on `HOSTED_SHARE_API_BASE_URL` plus the existing `HOSTED_WEB_BASE_URL` fallback.
- **Follow-on cleanup:** delete any local shell exports or `.env` entries that still use the removed alias.
- **Concrete risk if removed incorrectly:** hidden local scripts that export only `HOSTED_SHARE_BASE_URL` will silently fall back to `HOSTED_WEB_BASE_URL` or `null` until they are updated.

## completed in follow-up

### 1. Assistant session flat-field fallback into `providerBinding`

- **Files / symbols:** `packages/cli/src/assistant/provider-state.ts` - `normalizeAssistantSessionSnapshot`; `packages/cli/src/assistant-cli-contracts.ts` - `assistantSessionSchema`; `packages/cli/src/assistant/store/persistence.ts`
- **Compatibility behavior involved:** when the `providerBinding` key is absent, the session normalizer reconstructs it from legacy top-level `providerSessionId` and `providerState` fields.
- **What the follow-up landed:** session parsing, normalization, persistence, repair flows, and the remaining CLI runtime/tests now use nested `providerBinding` only; the flat top-level `providerSessionId` and `providerState` fields are no longer accepted or reconstructed.
- **What changed to make the hard cut safe:** the remaining builders and tests were updated first so cold resume, provider-route recovery, and session persistence still preserve provider session identity and resume state through `providerBinding`.
- **Residual risk after the cleanup:** stale ad hoc local JSON fixtures or manual edits that still emit flat provider fields will now fail schema validation instead of being silently normalized.

## keep for now

### 1. Vault metadata additive repair path

- **Files / symbols:** `packages/core/src/vault-metadata.ts` - `applyVaultMetadataCompatibilityDefaults`; `packages/core/src/vault.ts` - `loadVault`, `repairVault`; `packages/cli/src/text/shared.ts` - `formatStructuredErrorMessage`
- **Why it still appears required:** this is still an active operator workflow and runtime contract surface, not just dead migration glue. Current validation intentionally reports `VAULT_METADATA_REPAIR_RECOMMENDED` warnings and offers `vault repair` instead of turning additive scaffold drift into hard load failures.
- **Concrete risk if removed incorrectly:** existing vaults and fixtures with additive metadata drift stop loading or validating cleanly, and the supported repair path disappears.

### 2. Assistant doctor secret-header repair

- **Files / symbols:** `packages/cli/src/assistant/doctor-security.ts`; `packages/cli/src/commands/assistant.ts` - `assistant doctor --repair`
- **Why it still appears required:** although it looks like migration scaffolding, it still protects a live trust boundary by moving secret-bearing provider headers out of session JSON into private sidecars and tightening assistant-state file permissions.
- **Concrete risk if removed incorrectly:** operators lose the supported path for repairing leaked inline headers or permissive assistant-state modes, leaving sensitive material in the wrong files.

### 3. Hosted bundle keyring and read-time rekey support

- **Files / symbols:** `apps/cloudflare/src/crypto.ts` - `readEncryptedR2Payload`, `migrateEncryptedPayloadIfNeeded`; `apps/cloudflare/README.md`
- **Why it still appears required:** this is part of the current encrypted-bundle rotation contract, not just obsolete upgrade scaffolding. The current architecture still expects older key ids to remain readable while rotations are in progress.
- **Concrete risk if removed incorrectly:** key rotations can strand older encrypted bundle objects or convert successful reads into avoidable decryption failures.
