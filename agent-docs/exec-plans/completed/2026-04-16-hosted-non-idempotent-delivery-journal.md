Goal (incl. success criteria):
- Make the hosted assistant delivery journal the authoritative recovery surface for hosted non-idempotent outbound channels so Telegram/email replies no longer depend on local outbox delivery state after commit.
- Success means hosted finalize can distinguish `sent`, retryable failure, and terminal ambiguity from journal state alone for non-idempotent channels; ambiguous sends never auto-resend; direct regression coverage proves the old infinite confirmation-pending loop no longer occurs.

Constraints/Assumptions:
- Keep `apps/web` `execution_outbox` and Cloudflare execution-journal roles unchanged; this task is about delivery ownership, not control-plane enqueue semantics.
- Preserve existing richer retry behavior for idempotent transports such as Linq.
- Preserve unrelated worktree edits and the active Linq/onboarding lanes.
- Update durable docs when the hosted delivery-state contract changes.

Key decisions:
- Treat the hosted delivery journal as the only authoritative durable owner for hosted non-idempotent outbound recovery.
- Keep execution success and delivery success as separate outcomes in logs and summaries.
- Make terminal ambiguity explicit instead of retrying `ASSISTANT_DELIVERY_CONFIRMATION_PENDING` forever on non-idempotent channels.
- Maintain compatibility for already-written hosted journal records while migrating new writes to the expanded state model.

State:
- completed

Done:
- Confirmed live Telegram failures were recovery-ownership failures, not webhook ingress failures.
- Verified current hosted finalize still throws when the journal is prepared but local outbox delivery metadata is missing.
- Scoped the affected files, tests, and durable docs for the refactor.
- Expanded hosted delivery journal states and merge semantics to cover `pending`, `sending`, `sent`, `failed`, and `failed_ambiguous` while keeping legacy `prepared` reads compatible.
- Disabled generic persisted outbox delivery recovery on the hosted path and made hosted non-idempotent reconciliation journal-authoritative, including terminal ambiguity and terminal failure handling.
- Preserved the authoritative journal attempt metadata when stale `sending` records age into `failed_ambiguous`.
- Added regression coverage for journal-state merges, hosted callback reconciliation, terminal ambiguity precedence over local snapshots, terminal `failed` handling, and ambiguity replay message preservation.
- Updated durable hosted idempotency docs to describe the new hosted recovery contract.
- Completed required audit passes: `simplify`, `coverage-write`, and final completion review rerun.
- Re-ran focused package checks and the truthful `workspace-verify.sh test:diff ...` lane successfully after the review-driven fixes.

Now:
- Close the plan and create the scoped commit for the hosted delivery journal refactor.

Next:
- Hand off the final architecture/result summary plus the green verification evidence.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether any pre-existing hosted journal objects beyond legacy `prepared`/`sent` need extra migration normalization beyond parser compatibility.

Working set (files/ids/commands):
- `packages/hosted-execution/src/side-effects.ts`
- `apps/cloudflare/src/side-effect-journal.ts`
- `packages/assistant-runtime/src/hosted-runtime/{callbacks,execution,models}.ts`
- `packages/assistant-engine/src/assistant/{outbox.ts,outbox/dispatch-state.ts}`
- `packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts`
- `packages/assistant-engine/test/assistant-outbox-runtime.test.ts`
- `apps/cloudflare/test/{index,side-effect-journal}.test.ts`
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
