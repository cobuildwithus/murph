# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| Codex | Land external OpenAI Responses auto-compaction patch for assistant provider routing, response chaining, and no-local-compaction behavior | `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`, `packages/{assistant-core,cli}/{package.json,src/assistant/**,src/model-harness.ts,test/assistant-*.test.ts}` | `shouldUseAssistantOpenAIResponsesApi`, OpenAI Responses routing, `previousResponseId`, auto-compaction | In progress | Narrow supplied-patch landing. Preserve unrelated dirty-tree edits and port only the Responses-compaction delta. |
