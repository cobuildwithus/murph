# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Clarify route estimate precision wording | `agent-docs/exec-plans/active/2026-04-13-route-estimate-wording.md` | `packages/cli/src/commands/route.ts`, `packages/assistant-engine/src/assistant/system-prompt.ts`, `packages/{cli,assistant-engine}/test/**` | `registerRouteCommands`, `buildAssistantRoutingToolText` | in_progress | Keep this wording-only; do not touch the active local-hosted-dev lane files. |
