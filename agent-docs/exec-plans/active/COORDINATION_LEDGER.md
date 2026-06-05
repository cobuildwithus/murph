# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Conversation onboarding first-experiment prompt | none | `packages/assistant-engine/skills/conversation-onboarding/SKILL.md`; `packages/assistant-engine/test/assistant-skill-assets.test.ts` | `conversation-onboarding` | Active | Narrow prompt/test update; preserve existing adjacent assistant prompt edits. |
| Codex | Device-sync dirty ack requeue | `agent-docs/exec-plans/active/2026-06-05-device-sync-dirty-ack-requeue.md` | `apps/web/src/lib/device-sync/hosted-runtime-authority.ts`; `apps/web/test/device-sync-hosted-runtime-authority.test.ts`; `packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts` | `ackHostedDeviceSyncDirtyStateProcessed`; `signalHostedDeviceSyncBackgroundMaintenanceRuntime`; foreground preemption | Active | Narrow hosted device-sync liveness fix; no generic wake-priority or runner changes. |
