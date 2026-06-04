# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Hosted Codex continuity simplification | `agent-docs/exec-plans/active/2026-06-04-remove-codex-continuity-manifest.md` | `packages/runtime-state/src/hosted-bundles.ts`, `packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts`, `packages/assistant-engine/src/assistant/codex-turn/planning.ts`, `packages/assistant-engine/src/assistant/providers/**`, hosted continuity tests/docs | Codex rollout snapshots, restore sanitizer, transcript fallback | Planned | Plan authored only; implementation not started. |
