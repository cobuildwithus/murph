# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| Codex | Add missing hosted web env placeholders and Vercel setup docs for hosted execution/device-sync secrets | `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`, `apps/web/.env.example`, `apps/web/README.md`, `apps/web/test/vercel-config.test.ts` | hosted web env template/docs coverage for Vercel-managed secrets | in_progress | Narrow docs/config patch only. Do not change runtime behavior or expose real secret material. |
| Codex | Replace placeholder Cloudflare worker and R2 names in checked-in Wrangler scaffold with the live deployed names | `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`, `apps/cloudflare/wrangler.jsonc` | checked-in Cloudflare scaffold defaults for worker name and R2 buckets | in_progress | Narrow config hardening so local Wrangler commands stop failing on placeholder validation. Keep secret handling env-driven and do not hardcode credentials. |
| Codex | Land bounded local gateway reply-target/event-cursor fixes plus matching tests | `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`, `packages/cli/src/gateway/{local-service,send,snapshot}.ts`, `packages/cli/test/{gateway-core,gateway-local-service}.test.ts` | local gateway reply-to validation/resolution, event cursor monotonicity, redundant local send path cleanup | in_progress | Narrow supplied-patch landing. Stay within gateway-local runtime/test files and preserve adjacent `packages/cli` edits from other lanes. |
| Codex | Refresh workspace lockfile so frozen CI install matches current assistant-core dependency metadata | `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`, `pnpm-lock.yaml` | pnpm importer metadata for `packages/assistant-core` and dependent workspace links | in_progress | Narrow lockfile-only repair. Do not alter package manifests or unrelated dependency resolutions. |
