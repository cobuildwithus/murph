# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| Codex | Hard-cut remaining compatibility logic and migration fallbacks | `packages/runtime-state/**`, `packages/gateway-local/**`, `packages/query/**`, `packages/device-syncd/**`, `packages/inboxd/**`, `packages/assistant-core/**`, `packages/core/**`, `packages/contracts/**`, `apps/cloudflare/**`, related tests/docs | `promoteLegacyLocalState*`, `readLocalStateTextFileWithFallback`, `legacyParseValue`, `RELATED_IDS_COMPATIBILITY_RELATION`, `validateVaultMetadataWithCompatibility`, hosted pending-usage legacy migration | in_progress | Exclusive broad refactor lane across persisted-state/runtime compatibility seams; preserve unrelated adjacent edits carefully. |
