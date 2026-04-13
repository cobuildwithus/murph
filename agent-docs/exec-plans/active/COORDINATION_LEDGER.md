# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Root local hosted dev lane | `agent-docs/exec-plans/active/2026-04-13-local-hosted-dev-lane.md` | `package.json`, `scripts/dev-hosted-local.ts`, `apps/web/src/lib/hosted-execution/environment.ts`, `apps/web/test/hosted-execution-environment.test.ts`, `apps/cloudflare/.dev.vars.example`, `README.md` | `readHostedExecutionDispatchEnvironment`, `readHostedExecutionControlBaseUrl` | in_progress | Preserve unrelated dirty `apps/web` onboarding edits already in worktree; avoid touching those files unless required. |
