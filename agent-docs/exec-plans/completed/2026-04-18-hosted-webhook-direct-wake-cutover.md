## Goal

Cut active-member Linq and Telegram hosted webhook traffic over to direct canonical HostedWake append so webhook receipts stop acting as the primary dispatch lifecycle owner for message execution.

## Scope

- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-telegram.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
- `apps/web/test/hosted-onboarding-linq-dispatch.test.ts`
- `apps/web/test/hosted-onboarding-telegram-dispatch.test.ts`
- `apps/web/test/hosted-onboarding-webhook-idempotency.test.ts`

## Constraints

- Preserve webhook receipt ownership for receipt-local side effects such as Linq replies and invite bookkeeping.
- Preserve legacy dispatch-payload decoding during the cutover, but stop producing new Linq/Telegram wake rows that store full `HostedExecutionDispatchRequest` envelopes.
- Do not revert or disturb the in-flight hosted wake cleanup work already registered in the coordination ledger.
- Keep the current Cloudflare nudge flow, but source it from the canonical wake row rather than receipt-side dispatch staging.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts` ✅
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-telegram-dispatch.test.ts` ✅
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts` ✅
- `pnpm --filter @murphai/hosted-web typecheck` ❌ blocked by unrelated branch-wide failures:
  - missing `input-otp` resolution in `apps/web/src/components/ui/input-otp.tsx`
  - in-flight hosted-wake contract/export changes under `packages/hosted-execution/src/*`
  - stale test mocks outside this lane that still expect pre-rename wake helpers
- `bash scripts/workspace-verify.sh test:diff ...` ❌ blocked by unrelated `apps/web` package failures outside this lane:
  - the same `input-otp` dependency/type resolution issue
  - unrelated landing-page assertion drift
  - stale hosted-wake/mock expectations in tests not touched by this cutover
- Required completion audits per repo workflow
Status: completed
Updated: 2026-04-18
Completed: 2026-04-18
