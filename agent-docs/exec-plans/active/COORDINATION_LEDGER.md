# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| Codex | Make inbox capture the only canonical intake fact | `packages/inboxd/**`, `packages/contracts/**`, `packages/assistant-core/**`, related inbox tests/docs | `persistCanonicalInboxCapture`, `ensureStoredCaptureCanonicalEvidence`, inbox capture contract/docs | in_progress | Narrow persisted-intake lane; preserve adjacent edits from the active compatibility cleanup and avoid unrelated runtime-state refactors. |
| Codex | Hard-cut remaining compatibility logic and migration fallbacks | `packages/runtime-state/**`, `packages/gateway-local/**`, `packages/query/**`, `packages/device-syncd/**`, `packages/inboxd/**`, `packages/assistant-core/**`, `packages/core/**`, `packages/contracts/**`, `apps/cloudflare/**`, related tests/docs | `promoteLegacyLocalState*`, `readLocalStateTextFileWithFallback`, `legacyParseValue`, `RELATED_IDS_COMPATIBILITY_RELATION`, `validateVaultMetadataWithCompatibility`, hosted pending-usage legacy migration | completed | Exclusive broad refactor lane across persisted-state/runtime compatibility seams; cleanup landed and verification passed. |
| Codex | Add explicit runtime-state portability classification for hosted snapshots | `packages/runtime-state/**`, `ARCHITECTURE.md`, `apps/cloudflare/README.md`, `agent-docs/operations/agent-workflow-routing.md` | `describeVaultLocalStateRelativePath`, hosted workspace snapshot inclusion policy | in_progress | Narrow persisted-state policy lane inside runtime-state; preserve adjacent compatibility-cleanup edits and avoid unrelated Cloudflare/runtime refactors. |
| Codex | Simplify gateway-local persisted derived storage to source tables only | `packages/gateway-local/src/store/**`, `packages/gateway-local/README.md`, `packages/cli/test/gateway-local-service.test.ts` | `LocalGatewayProjectionStore`, `resetGatewayServingSnapshotSchema`, `readSnapshotState`, gateway-local storage tests | in_progress | Overlaps the existing exclusive gateway-local compatibility lane; read live file state first and preserve unrelated adjacent edits. |
