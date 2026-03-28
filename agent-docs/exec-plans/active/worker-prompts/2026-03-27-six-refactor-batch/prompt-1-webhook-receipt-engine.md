You are Codex Worker W1 operating in the current shared worktree. Do not create a commit.

Before any code changes:
- Read `AGENTS.md` and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Use the pre-registered ledger row `codex-worker-webhook-receipt-engine`; update it if scope shifts, and remove it before finishing.
- Keep this behavior-preserving: do not change the Prisma schema, receipt payload shape, legacy receipt compatibility, webhook response contract, or dispatch semantics.

After changes:
- Run the narrowest truthful tests you touch.
- Remove your ledger row before finishing.
- Final response: summary, files changed, tests run, blockers.

Task:

Simplify the hosted onboarding webhook path by extracting the generic receipt/side-effect state machine out of `apps/web/src/lib/hosted-onboarding/webhook-service.ts`.

Relevant files/symbols:
- `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
  - `handleHostedOnboardingLinqWebhook`
  - `handleHostedStripeWebhook`
  - `recordHostedWebhookReceipt`
  - `reclaimHostedWebhookReceipt`
  - `queueHostedWebhookReceiptSideEffects`
  - `drainHostedWebhookReceiptSideEffects`
  - `markHostedWebhookReceiptCompleted`
  - `markHostedWebhookReceiptFailed`
  - `HostedWebhookReceiptState` plus the receipt codec and side-effect merge helpers
- `apps/web/src/lib/hosted-onboarding/service.ts`

Regression anchors to preserve:
- `apps/web/test/hosted-onboarding-webhook-idempotency.test.ts`
  - the Linq active-member durable-queue case
  - the Stripe invoice durable-update/activation-dispatch case
  - duplicate/in-flight/malformed receipt cases
  - Linq resend/reclaim cases
  - legacy flat receipt compatibility cases
  - RevNet retry/idempotency cases

Best-guess fix:
1. Move the receipt JSON codec and side-effect merge logic into a focused helper module such as `webhook-receipts.ts`.
2. Introduce a small helper such as `runHostedWebhookWithReceipt(...)` that owns claim/reclaim, queue/drain, and completed/failed transitions.
3. Keep source-specific business logic in small Linq and Stripe helpers.

Overlap notes:
- `apps/web/src/lib/hosted-onboarding/webhook-service.ts` is a live hosted-onboarding surface with adjacent billing/revnet edits nearby. Read the live file carefully and preserve unrelated changes.
- Keep this worker off unrelated hosted-share or device-sync files.

