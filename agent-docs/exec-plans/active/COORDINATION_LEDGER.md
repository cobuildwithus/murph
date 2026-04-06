# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| Codex | Land the returned hosted-architecture cleanup patch where it still applies in the current tree | `apps/cloudflare/**`, `apps/web/**`, `packages/hosted-execution/**`, durable docs/process files, and any directly touched hosted-runtime shared packages` | hosted device-sync runtime ownership, pending-usage storage/indexing, outbox payload refs, hosted member access semantics, DO runtime bootstrap metadata | in_progress | Cross-cutting hosted-runtime patch lane. Preserve the separate assistant-core capability-catalog work already in progress and avoid pulling its files into this change. |
