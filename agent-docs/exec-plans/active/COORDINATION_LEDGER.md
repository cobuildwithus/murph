# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| Codex | Add missing hosted web env placeholders and Vercel setup docs for hosted execution/device-sync secrets | `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`, `apps/web/.env.example`, `apps/web/README.md`, `apps/web/test/vercel-config.test.ts` | hosted web env template/docs coverage for Vercel-managed secrets | in_progress | Narrow docs/config patch only. Do not change runtime behavior or expose real secret material. |
| Codex | Replace placeholder Cloudflare worker and R2 names in checked-in Wrangler scaffold with the live deployed names | `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`, `apps/cloudflare/wrangler.jsonc` | checked-in Cloudflare scaffold defaults for worker name and R2 buckets | in_progress | Narrow config hardening so local Wrangler commands stop failing on placeholder validation. Keep secret handling env-driven and do not hardcode credentials. |
| Codex | Land bounded assistant tool-runtime parity patch for OpenAI-compatible provider turns and matching docs/tests | `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`, `packages/cli/src/assistant/provider-turn-runner.ts`, `packages/cli/src/assistant/providers/{openai-compatible,registry,types}.ts`, `packages/cli/src/assistant-cli-tools.ts`, `packages/cli/test/{assistant-provider,assistant-service,inbox-model-harness}.test.ts`, `ARCHITECTURE.md`, `agent-docs/{RELIABILITY,SECURITY}.md` | OpenAI-compatible bound tool runtime, assistant prompt tool guidance parity, shared assistant tool catalog exposure | in_progress | Narrow supplied-patch landing. Preserve adjacent `packages/cli` edits from the active gateway lane; avoid unrelated package/config churn. |
