You are worker 1 for the hosted hard-cut migration batch. You are not alone in
the codebase. Work carefully on top of the current tree, do not revert other
changes, and adjust to nearby edits instead of overwriting them.

Read first:

- `AGENTS.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-18-hosted-hard-cut-migration.md`
- `docs/hosted-hard-cut-migration-guide.md`

Goal:

- Remove active-member Linq and Telegram message traffic from the webhook receipt
  wrapper so those hot paths execute as direct wake append plus wake nudge.
- Preserve receipt-managed onboarding, invite, quota-reply, and other
  receipt-local side effects.

Write scope:

- `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-telegram.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-receipt-*.ts` only if strictly required
- focused hosted-web tests for Linq/Telegram webhook dispatch/idempotency

Do not touch:

- `packages/assistant-runtime/**`
- `apps/cloudflare/**`
- shared hosted-execution contract renames beyond tiny compile-through changes

Context from the live tree:

- `webhook-provider-linq.ts` and `webhook-provider-telegram.ts` already append
  direct wake payloads for active-member traffic.
- `webhook-service.ts` still wraps both providers in
  `runHostedWebhookWithReceipt(...)` and then calls
  `maybeHandoffHostedExecutionWebhookWake(...)`.
- The migration guide treats that wrapper as the remaining ingress hot-path seam.

Implementation target:

- Introduce a direct fast path for active-member message traffic that:
  1. authenticates and plans provider policy in web
  2. appends the canonical wake in the same DB transaction
  3. acknowledges without going through receipt continuation state
  4. nudges Cloudflare best-effort from the appended wake target
- Keep receipt handling for non-active-member flows and receipt-local side
  effects.

Constraints:

- Preserve duplicate protection.
- Preserve current response payloads unless a focused test update proves a better
  shape is necessary.
- Do not reintroduce `execution_outbox`, stored dispatch payloads, or awaited
  recovery semantics.

Verification:

- Run the highest-signal focused tests you touch, for example:
  - `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts --no-coverage`
  - `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-telegram-dispatch.test.ts --no-coverage`
  - `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts --no-coverage`

Final response format:

- summary of what changed
- exact files changed
- verification run and outcomes
- any blockers or follow-up risks
