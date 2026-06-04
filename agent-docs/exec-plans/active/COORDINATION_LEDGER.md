# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Conversation onboarding first-experiment prompt | none | `packages/assistant-engine/skills/conversation-onboarding/SKILL.md`; `packages/assistant-engine/test/assistant-skill-assets.test.ts` | `conversation-onboarding` | Active | Narrow prompt/test update; preserve existing adjacent assistant prompt edits. |
| Codex | Hosted member reset script hardening | `agent-docs/exec-plans/active/2026-06-04-hosted-member-reset-script-hardening.md` | `apps/web/scripts/reset-hosted-member-runtime.ts`; `apps/web/test/reset-hosted-member-runtime-script.test.ts` | `reset-hosted-member-runtime` | Active | Script-scoped follow-up; preserve unrelated assistant-engine edits. |
