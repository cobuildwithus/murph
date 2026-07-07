Goal (incl. success criteria):
- A fresh user conversation message must preempt in-flight and not-yet-started background automation (cron scan/jobs, managed automations) so the reply runs first, per User Reply Primacy. Plus per-step timing spans on the conversation import path so the 13s/19s mid-pass stalls can be attributed (lock wait vs work vs starvation).
- Success: (1) regression proving a conversation input staged mid-automation flips the runner yield signal at STAGING time and the existing cron foreground-yield machinery defers the automation (occurrence kept pending, retried); (2) regression proving the assistant phase skips the automation lane when a replyable pending input exists before the lane starts, preserving an immediate assistant wake; (3) regression proving system-lane wakes still do NOT preempt (PR #354 round-10 narrowing preserved); (4) import spans visible in phase_breakdown_json + mailbox.imported log with no new tables/writers.

Constraints/Assumptions:
- Minimal complexity: no new state owners, queues, controllers, or effect kinds. The runner-owned detector (workspace-runner.ts shouldYieldBackgroundMaintenance / foregroundConversationWorkObserved) stays the single preemption owner; cron/execution's existing foreground abort + 10s pendingOccurrenceAt retry stays the mid-turn stop path. Do NOT repurpose active-turn admission hooks for non-reply turns.
- Preemption trigger = staged user CONVERSATION input only (not generic runtime wakes, not system-lane items).
- Post-provider-admission non-replayable background maintenance (e.g. overnight memory consolidation) keeps today's behavior.
- Deferral relies on existing durable re-run paths (pendingOccurrenceAt + 10s catch-up wake); 60-min notification expiry interaction documented, no exemption classes added now.
- Spans ride existing plumbing: stage-1 (fetch/decode/prepare/stage) into phaseBreakdown.import before the staged trace record; stage-2 (prepareWakeContext/importConversationWake/parser drain/attachment evidence elapsed) into the existing mailbox.imported runtime-log redactedJson.

Key decisions:
- Root cause chain (prod 2026-07-06 incident): wake reached foreground loop in 1ms, but foregroundConversationWorkObserved flips only when the import CALL returns; the 32s import stall therefore also starved the yield signal, so cron's 50ms shouldYield polls kept returning false and the automation turn ran to completion. Fix the SIGNAL, reuse the machinery.
- Move 1: staging-time signal — optional callback threaded through the existing import-item context, invoked in importHostedConversationMailboxItem at the staging point (non-replay only), wired by the foreground import loop to flip foregroundConversationWorkObserved immediately.
- Move 2: pre-automation-lane gate in workspace-assistant-phase before runAutomationLane call sites (~594-597, ~640-643): fresh conversation input always runs the lane; only no-fresh-input passes consult the runner yield predicate and pending-input probe before skipping with an immediate assistant wake.
- Preemption is global (any background automation yields to any fresh user message), per invariants §Foreground mailbox priority.

State:
- Done.

Done:
- Investigation + Codex seam map (existing machinery, incident replay, deferral safety per work class).

Now:
- Ready to commit and open the PR; deep-review loop next.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None (global-preemption, expiry, post-admission, and cadence decisions recorded above).

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-import.ts` (context type only, if needed)
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`, `packages/assistant-runtime/test/hosted-runtime-mailbox-conversation-import.test.ts`, `packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase*.test.ts` (as fits existing layout)
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07
