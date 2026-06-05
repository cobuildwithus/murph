# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Hosted runtime host timeout removal | `agent-docs/exec-plans/active/2026-06-05-remove-host-runtime-deadline.md` | `apps/cloudflare/**`; `packages/assistant-runtime/**`; `packages/hosted-execution/**`; `packages/hosted-local-harness/**`; hosted runtime docs/config/tests | runner timeout env; write-fence owner watchdog; hosted runtime idle checkpoint | Active | New worktree per user request; preserve unrelated rows. |
| Codex | Conversation onboarding first-experiment prompt | none | `packages/assistant-engine/skills/conversation-onboarding/SKILL.md`; `packages/assistant-engine/test/assistant-skill-assets.test.ts` | `conversation-onboarding` | Active | Narrow prompt/test update; preserve existing adjacent assistant prompt edits. |
