# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Conversation onboarding first-experiment prompt | none | `packages/assistant-engine/skills/conversation-onboarding/SKILL.md`; `packages/assistant-engine/test/assistant-skill-assets.test.ts` | `conversation-onboarding` | Active | Narrow prompt/test update; preserve existing adjacent assistant prompt edits. |
| Codex | Vault CLI Commons command deletion | `agent-docs/exec-plans/active/2026-06-05-vault-cli-import-storm.md` | `packages/cli/src/commands/commons.ts`; `packages/cli/src/vault-cli-command-manifest.ts`; `packages/cli/src/incur.generated.ts`; `packages/cli/config.schema.json`; `packages/cli/test/**`; `packages/assistant-engine/src/assistant/system-prompt.ts`; `packages/assistant-engine/skills/**`; `packages/assistant-engine/test/**`; `docs/contracts/03-command-surface.md`; `e2e/smoke/scenarios/**` | `commons search`; `commons get`; `commons source list`; Incur command topology | Active | Narrow deletion of unused Commons commands before lazy-dispatch work. Preserve unrelated active prompt/test lane and unrelated hosted reset route edit. |
