# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | hosted-local runner CLI bundle | `agent-docs/exec-plans/active/2026-05-03-hosted-local-cli-bundle.md` | `apps/cloudflare/package.json`, `scripts/dev-hosted-local/**`, `packages/hosted-local-harness/**`, `apps/cloudflare/test/**` | runner bundle assembly, hosted-local setup | active | No overlap with hosted-web row expected. |
