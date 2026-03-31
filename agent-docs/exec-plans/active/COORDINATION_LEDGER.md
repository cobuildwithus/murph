# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| Codex | Hard-cut gateway ownership into `@murph/gateway-core` and reduce CLI gateway paths to compatibility re-exports | `agent-docs/exec-plans/active/{COORDINATION_LEDGER,2026-03-31-gateway-core-full-cutover}.md`, `packages/gateway-core/**`, `packages/cli/src/{gateway-core,gateway-core-local,gateway-daemon-client}.ts`, `packages/cli/src/gateway/**`, `packages/assistant-core/src/index.ts`, gateway docs/tests | `createLocalGatewayService`, `sendGatewayMessageLocal`, `gatewayBindingDeliveryFromRoute`, gateway compatibility re-exports | In progress | Broad gateway refactor lane. Preserve unrelated local-web/docs/setup edits and port only the hard-cut gateway delta. |
| Codex | Make `scripts/finish-task` preflight commit paths before closing plans and accept changed-file directory inputs | `scripts/finish-task`, `AGENTS.md`, `agent-docs/{PLANS.md,operations/completion-workflow.md,exec-plans/active/README.md}`, `agent-docs/exec-plans/active/{COORDINATION_LEDGER,2026-03-31-finish-task-preflight.md}.md` | `resolve_commit_paths`, `expand_commit_target`, `append_unique_path` | In progress | Narrow workflow-helper lane only; preserve existing gateway/onboarding edits. |
