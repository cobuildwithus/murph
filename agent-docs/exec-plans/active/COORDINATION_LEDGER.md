# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| Codex | Speed up low-risk repo verification and tiny-change workflow paths | `scripts/workspace-verify.sh`, `agent-docs/operations/**`, `agent-docs/references/testing-ci-map.md`, and the active plan | low-risk scoped verification, app-verify fast path, retry defaults, timing telemetry, tiny-change completion rules | in_progress | Narrow workflow/tooling lane. Do not touch the active hosted-runtime implementation files already in progress elsewhere. |
| Codex | Quiet known SQLite experimental warning noise in the repo Vitest lane | `vitest.config.ts`, `config/**`, package/app `vitest*.ts`, shared test helpers, and the coordination ledger | shared Vitest startup, sqlite experimental warning suppression, coverage/test stderr noise | in_progress | Narrow test-infra lane. Preserve existing warning semantics outside repo-owned test processes. |
