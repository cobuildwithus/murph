# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| codex-incur-doc-trim | Move incur-specific CLI guidance into a dedicated note and reduce the broader agent docs to short routing pointers. | `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`, `agent-docs/index.md`, `ARCHITECTURE.md`, `agent-docs/operations/verification-and-runtime.md`, `agent-docs/references/incur-notes.md`, `agent-docs/generated/doc-inventory.md` | incur skill routing note; dedicated CLI framework note; short agent-doc pointers only | in_progress | Docs-only lane. Avoid touching unrelated active/completed plan files currently being moved by other lanes. |
