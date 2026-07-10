Goal (incl. success criteria):
- Resume a hosted assistant task immediately after the member approves or denies its secure action, without requiring the member to send a confirmation message.
- Generalize through the existing durable mailbox plus pointer-only Temporal wake path so other trusted asynchronous outcomes can resume Murph without a new scheduler or state owner.
- Success means the browser decision transaction commits one deduplicated outcome wake, signals the existing per-user workflow, the runtime consumes the outcome and retries the parked effect, and focused tests prove approval, denial, replay, and failure behavior.

Constraints/Assumptions:
- Web remains the owner of approval decisions and hosted mailbox facts.
- Temporal remains pointer-only orchestration; a signal is a latency hint, never product truth.
- The runtime remains the owner of parked delivery intents and final side-effect execution.
- Preserve foreground conversation priority, action fingerprint validation, one-time approval consumption, privacy boundaries, and all unrelated worktree or ledger rows.
- Prefer an existing generic external-outcome/control primitive over an approval-specific scheduler, callback, polling loop, or new persisted table.

Key decisions:
- Add one payload-free `runtime.pending-effects-reconcile-requested` system-mailbox control kind. It means a trusted owner committed state that may unblock an already-persisted effect; it is never approval or completion truth.
- Append the control row in the same Postgres transaction as approval or denial, with a stable identity derived from approval identity, committed decision time, and decision, then send the existing pointer-only `mailbox_appended` signal after commit.
- Route the control row through the existing runtime-control receipt path and collect bounded background delivery effects only. Do not continue the assistant automation lane or invoke Codex.
- Keep phone-call outcome notifications on the existing `assistant.notification.requested` primitive; phone results need a generated user-facing summary, while approval decisions only unblock a typed parked delivery.
- Redirect back to the originating Murph conversation without pre-filling a confirmation message.

State:
- Implementation, focused proof, and required completion audits complete; publishing in progress.

Done:
- Loaded the hosted runtime, mailbox, Temporal, security, reliability, approval, and messaging contracts.
- Isolated work on a dedicated task branch and worktree.
- Proved the current payloadless Temporal recheck cannot start work because approval state is not a reconciliation fact or mailbox lag.
- Proved `runtime.manual-requested` is the wrong reuse point because it is AI-usage-gated and continues assistant automation.
- Traced the phone-result notification primitive and the bounded parked-delivery approval reconciliation path.
- Added the payload-free hosted-execution contract/parser and runtime routing that reconciles persisted delivery effects without entering the assistant lane.
- Made the approval decision and system-mailbox append one Postgres transaction, followed by the existing best-effort pointer-only Temporal signal.
- Removed the redirect's pre-filled approval/denial confirmation message.
- Added route, parser, runtime, and Postgres integration coverage, including transaction rollback, refreshed-generation wake identity, and signal-failure behavior.
- Passed focused hosted-execution, assistant-runtime, workspace-runner, web route/UI, and isolated Postgres suites plus all changed-owner typechecks and docs drift.
- The canonical diff verifier cleared all architecture/safety guards, affected typechecks, and thousands of downstream tests; its remaining full-graph result is blocked by the shared host taking 76.5 seconds to complete an unrelated assistant-CLI import guard with a fixed 60-second timeout. The temporary extended-timeout proof passed and was reverted.
- Security/privacy and coverage-write audits returned no findings; the frontend audit returned no evidence-backed finding and retained only a render gap.
- The required Fable route was unavailable (primary usage exhausted; secondary authentication expired), so the pre-existing already-decided revisit copy was not changed. The decision response covered here returns a bare conversation link and no longer creates the confirmation-message composer shown in the reported flow.

Now:
- Final diff/privacy review, plan closure, commit, push, PR, ReviewGPT, and CI.

Next:
- Deploy consumers before the web producer and verify one real approval handoff.

Open questions (UNCONFIRMED if needed):
- None. Denial uses the same reconciliation wake so the parked intent terminalizes without generating an unsolicited acknowledgement.

Working set (files/ids/commands):
- docs/hosted-sensitive-action-approvals.md
- apps/web/app/api/action-approvals/[approvalId]/decision/route.ts
- apps/web/src/lib/action-approvals.ts
- apps/web/src/lib/hosted-mailbox/**
- packages/hosted-execution/src/{contracts,parsers,runtime-control}.ts
- packages/assistant-runtime/src/hosted-runtime*
- packages/assistant-engine/src/assistant/**
- focused apps/web, assistant-runtime, and assistant-engine tests
Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
