# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Conversation onboarding first-experiment prompt | none | `packages/assistant-engine/skills/conversation-onboarding/SKILL.md`; `packages/assistant-engine/test/assistant-skill-assets.test.ts` | `conversation-onboarding` | Active | Narrow prompt/test update; preserve existing adjacent assistant prompt edits. |
| Codex | Vault CLI import-storm remediation plan | `agent-docs/exec-plans/active/2026-06-05-vault-cli-import-storm.md` | `packages/cli/src/bin.ts`; `packages/cli/src/cli-entry.ts`; `packages/cli/src/vault-cli.ts`; `packages/cli/src/vault-cli-command-manifest.ts`; `packages/cli/src/commands/**`; `packages/cli/test/**` | `vault-cli` command registration; Incur command topology | Planned | Planning artifact only in this turn; no implementation edits yet. Preserve unrelated active prompt/test lane. |
