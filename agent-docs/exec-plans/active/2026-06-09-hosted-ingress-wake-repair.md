Goal (incl. success criteria):
- Prevent committed hosted foreground mailbox items from being stranded when the post-commit Temporal wake handoff fails.
- Keep the fix minimal: reuse existing mailbox rows and provider retry/idempotency rather than adding a new queue, scheduler, or persisted handoff table.
- Success means duplicate active-member webhook retries re-handoff the existing mailbox item, foreground handoff failure is retryable/fail-closed, and Temporal activity failures use bounded retry instead of signal-only sleep.

Constraints/Assumptions:
- Web remains owner of mailbox facts and ingress idempotency.
- Temporal remains pointer-only orchestration/timer/retry owner.
- Do not reintroduce demand/source/reason product semantics.
- Preserve unrelated worktree edits and active ledger rows.

Key decisions:
- Do not add a durable outbox yet; provider retry plus idempotent duplicate re-handoff is the smallest current fix.
- Treat foreground webhook wake handoff failure as a failed ingress response so providers can retry.
- Keep true idle signal-only waits; failed processing/reconciliation activity attempts must retry on a bounded timer.

State:
- In progress.

Done:
- Review identified missed handoff and duplicate no-rehandoff risks.

Now:
- Patch hosted webhook handoff and Temporal retry behavior.

Next:
- Add focused regression tests and run targeted verification.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts
- apps/web/src/lib/hosted-onboarding/webhook-provider-whatsapp.ts
- apps/web/src/lib/hosted-onboarding/webhook-service-wake.ts
- apps/web/src/lib/hosted-onboarding/webhook-service.ts
- apps/web/test/hosted-onboarding-webhook-idempotency.test.ts
- apps/web/test/hosted-onboarding-whatsapp-service.test.ts
- apps/web/test/hosted-execution-handoff.test.ts
- packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts
- packages/hosted-orchestrator-temporal/test/hosted-user-runtime-workflow.test.ts
