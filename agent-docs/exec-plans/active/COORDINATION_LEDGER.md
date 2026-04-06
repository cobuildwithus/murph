# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| Codex | Propagate provider-turn runtime gating from catalogs to capability registries | `packages/assistant-core/src/assistant-cli-tools/catalog-profiles.ts`, `packages/assistant-core/src/assistant/provider-turn-runner.ts`, `packages/assistant-core/test/assistant-hosted-device-connect-tool.test.ts`, `packages/cli/test/assistant-service.test.ts` | `createProviderTurnAssistantCapabilityRegistry`, `createProviderTurnAssistantToolCatalog`, `buildAssistantProviderTurnExecutionPlan` | in_progress | Narrow assistant-core refactor lane; preserve execution behavior while moving prompt/runtime availability checks onto the registry. |
