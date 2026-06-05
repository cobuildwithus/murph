# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Conversation onboarding first-experiment prompt | none | `packages/assistant-engine/skills/conversation-onboarding/SKILL.md`; `packages/assistant-engine/test/assistant-skill-assets.test.ts` | `conversation-onboarding` | Active | Narrow prompt/test update; preserve existing adjacent assistant prompt edits. |
| Codex | Delete cold Codex app-server path | `agent-docs/exec-plans/active/2026-06-05-delete-cold-codex-app-server.md` | `packages/assistant-engine/src/assistant-codex.ts`; `packages/assistant-engine/src/codex-lifecycle.ts`; `packages/assistant-engine/test/assistant-codex-runtime.test.ts`; `packages/assistant-engine/test/assistant-wrapper-exports.test.ts`; `packages/assistant-runtime/test/**`; `apps/cloudflare/src/container-entrypoint.ts`; `apps/cloudflare/test/container-entrypoint.test.ts`; `ARCHITECTURE.md`; `docs/contracts/00-invariants.md`; package READMEs | `executeCodexAppServerTurn`; warm Codex lifecycle hooks; Codex app-server process slot | Active | Exclusive for assistant-engine Codex lifecycle symbols; do not overlap process slot/shutdown edits. |
