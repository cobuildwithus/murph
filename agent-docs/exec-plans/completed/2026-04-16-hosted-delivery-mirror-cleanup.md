Goal (incl. success criteria):
- Finish the hosted non-idempotent delivery cleanup so local outbox state is an explicit mirror/scheduler for hosted journal-owned recovery rather than implicitly reusing generic `deliveryConfirmationPending` semantics.
- Success means hosted Telegram/email intents can keep polling/reconciling the authoritative hosted journal without local delivery snapshots or local confirmation flags acting as resend authority, while idempotent/generic outbox behavior remains unchanged.

Constraints/Assumptions:
- Keep `apps/web` `execution_outbox` and Cloudflare execution/side-effect journal roles unchanged.
- Preserve the hosted journal authority fix already landed in commit `4523b1bf`.
- Minimize schema churn beyond what is needed to make the local mirror role explicit.
- Preserve idempotent/local outbox semantics for Linq and non-hosted callers.

Key decisions:
- If local scheduling still needs metadata for hosted journal polling, store that as explicit authority/mirror metadata instead of generic confirmation-pending control state.
- Keep terminal hosted non-idempotent outcomes (`failed`, `failed_ambiguous`, `sent`) authoritative from the hosted journal.
- Prefer a narrow schema+state-machine refinement over a broad new summary or status taxonomy.

State:
- completed

Done:
- Confirmed the remaining gap after the authoritative-journal refactor is local outbox scheduling semantics, not delivery correctness.
- Identified `deliveryConfirmationPending` in `dispatchAssistantOutboxIntent` / `dispatch-state.ts` as the main remaining implicit control mechanism for hosted non-idempotent polling.
- Added explicit `deliveryStateAuthority` metadata to assistant outbox intents so hosted journal-owned delivery recovery is represented directly instead of piggybacking on generic confirmation state.
- Updated outbox dispatch and dispatch-state helpers so hosted non-idempotent retries stay in reconcile/scheduler mode without restoring local confirmation ownership, while idempotent replay behavior remains unchanged.
- Added regression coverage for hosted-journal non-idempotent retry scheduling and for the hosted runtime callback passing the journal-owned authority flag.
- Ran focused vitest/typecheck checks plus package-local coverage for `packages/operator-config`, `packages/assistant-engine`, and `packages/assistant-runtime`.
- Ran required completion audits: `coverage-write` returned no additional proof edits needed, and `task-finish-review` returned no findings.

Now:
- Close the active plan with a scoped commit once the final handoff is prepared.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether future operator/status surfaces should expose hosted-journal mirror ownership explicitly, or whether the current status-only summary remains sufficient.

Working set (files/ids/commands):
- `packages/operator-config/src/assistant-cli-contracts.ts`
- `packages/assistant-engine/src/assistant/outbox.ts`
- `packages/assistant-engine/src/assistant/outbox/{dispatch-state,retry-policy,summary}.ts`
- `packages/assistant-engine/test/{assistant-outbox-runtime,assistant-outbox-retry-policy,outbox-dispatch-state}.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts`
- `pnpm --dir packages/operator-config test:coverage`
- `pnpm --dir packages/assistant-engine test:coverage`
- `pnpm --dir packages/assistant-runtime test:coverage`
- `bash scripts/workspace-verify.sh test:diff packages/operator-config/src/assistant-cli-contracts.ts packages/assistant-engine/src/assistant/outbox.ts packages/assistant-engine/src/assistant/outbox/dispatch-state.ts packages/assistant-engine/test/assistant-outbox-runtime.test.ts packages/assistant-engine/test/outbox-dispatch-state.test.ts packages/assistant-runtime/src/hosted-runtime/callbacks.ts packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts agent-docs/exec-plans/active/COORDINATION_LEDGER.md agent-docs/exec-plans/active/2026-04-16-hosted-delivery-mirror-cleanup.md`
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
