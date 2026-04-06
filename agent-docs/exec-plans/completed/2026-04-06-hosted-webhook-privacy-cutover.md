## Goal

Land the supplied hosted webhook privacy cutover so webhook receipt persistence stores only control-plane state plus staged Cloudflare dispatch references, not raw Linq or Telegram dispatch payload snapshots.

## Success Criteria

- Webhook receipt side effects fail closed unless provider dispatch payloads are staged into the hosted-execution encrypted payload store before persistence or enqueue.
- Persisted webhook receipt JSON keeps staged dispatch refs rather than raw provider payload snapshots or message content.
- The receipt outbox path can enqueue already-staged payload envelopes without rebuilding raw dispatch payloads from receipt JSON.
- Privacy regression tests cover both the fail-closed staging path and the absence of raw message content or phone lookup keys in receipt persistence.

## Scope

- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/src/lib/hosted-execution/outbox.ts`
- `apps/web/test/hosted-onboarding/**`

## Constraints

- Treat the supplied patch as behavioral intent, not overwrite authority; preserve any live-tree differences that are unrelated to this privacy cutover.
- Keep the change bounded to the webhook receipt and hosted-execution staging seam; do not widen into broader hosted-member identity storage work in this turn.
- This is a high-sensitivity hosted persistence/trust-boundary change, so verification must include direct privacy-focused proof in addition to scripted checks.

## Verification

- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm --dir apps/web lint`
- Focused privacy regression proof for the staged-dispatch and receipt-minimization paths

## Notes

- Narrow supplied-patch landing, but plan-bearing because it changes persisted hosted receipt content and the hosted execution enqueue boundary.
- Landed follow-up fixes beyond the supplied patch:
  - cleanup of newly staged payload refs on receipt-write failure and partial staging failure
  - fail-closed hydration for legacy persisted dispatch snapshot shapes instead of silently dropping them
- Focused verification passed:
  - `./node_modules/.bin/tsc -p apps/web/tsconfig.json --pretty false`
  - `./node_modules/.bin/vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-onboarding-webhook-receipt-transitions.test.ts apps/web/test/hosted-onboarding/webhook-receipt-privacy.test.ts apps/web/test/hosted-execution-outbox.test.ts --no-coverage`
  - `./node_modules/.bin/eslint ...` from `apps/web` on the touched webhook files/tests
  - direct scenario proof: staged reference receipt serialization retained the payload ref and omitted raw message content and phone lookup keys
- Repo-wide blockers remain unrelated to this lane:
  - `pnpm typecheck` fails on existing `@murphai/assistant-engine` export errors in `packages/assistantd/src/service.ts` and `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
  - `pnpm test:coverage` fails immediately on the same unrelated assistant-engine export break during prepared runtime build
  - later `pnpm --dir apps/web lint` invocations were blocked before ESLint start by pnpm workspace lockfile verification outside this webhook lane, so direct ESLint was used for final changed-file proof
Status: completed
Updated: 2026-04-06
Completed: 2026-04-06
