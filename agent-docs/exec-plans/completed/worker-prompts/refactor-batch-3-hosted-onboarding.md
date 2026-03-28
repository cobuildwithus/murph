You are Codex Worker R3 operating in the current shared worktree. Do not create a commit.

Before any code changes:
- Read `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Add your own row as `Codex Worker R3` with this lane's files/symbols and mark it `in_progress`.
- Keep this patch to hosted onboarding service/tests unless a tiny adjacent helper is strictly required.

After changes:
- Run the narrowest relevant tests you touch.
- Remove your ledger row before finishing.
- Final response: summary, files changed, tests run, blockers.

Task:

Fix webhook idempotency/error handling in hosted onboarding so partial failures are retry-safe.

Relevant files/symbols:
- `apps/web/src/lib/hosted-onboarding/service.ts`
  - `handleHostedOnboardingLinqWebhook`
  - `handleHostedStripeWebhook`
  - `recordHostedWebhookReceipt`
  - `applyStripeCheckoutCompleted`
  - `applyStripeCheckoutExpired`
  - `applyStripeSubscriptionUpdated`
  - `applyStripeInvoicePaid`
  - `applyStripeInvoicePaymentFailed`
  - `dispatchHostedExecutionSafely`
- Regression anchors:
  - `apps/web/test/hosted-onboarding-linq-dispatch.test.ts`

Expected new coverage:
- Add focused Stripe/Linq webhook idempotency or retry-after-partial-failure tests if they are missing.

Best-guess fix:
1. Change webhook receipt handling to a two-phase or transactional model so only successfully completed webhooks are treated as duplicates.
2. Keep non-durable dispatch side effects clearly separated from durable completion state.
3. Make swallowed dispatch failures observable without marking the webhook permanently handled.

Guardrails:
- Preserve existing webhook payload semantics unless retry-safety requires a local status field or equivalent.
- Keep the change scoped to hosted onboarding service/test files.
