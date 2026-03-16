# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| codex-incur-upgrade | Upgrade `packages/cli` to the latest `incur` release and reconcile any help/CTA/typegen fallout from the upstream release notes. | `packages/cli/package.json`, `pnpm-lock.yaml`, `packages/cli/src/incur.generated.ts`, `packages/cli/test/incur-smoke.test.ts`, `agent-docs/exec-plans/active/2026-03-16-incur-0-3-4-upgrade.md`, `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` | `incur` dependency version, generated `incur` command register typings, root help assertions | in_progress | Narrow CLI-framework lane. Preserve adjacent setup edits; no overlap expected beyond shared docs/ledger bookkeeping. |
