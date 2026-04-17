## Goal

Debug the hosted Linq no-reply / continuity failure end to end, identify the actual current root cause, and land the smallest reliable fix plus regression proof.

## Why now

- Production Linq still shows typing indicators without a delivered reply.
- The latest local webhook E2E reproduction may be partially invalid because its manual activation fixture does not match the real hosted web activation identity binding.
- We need a production-faithful local repro before changing runtime behavior again.

## Guardrails

- Preserve unrelated hosted work already in flight.
- Do not assume the old stale-run-lease bug explains the current failure on the newest deploy.
- Keep verification truthful and centered on the hosted-local Linq E2E lane plus focused runtime/unit proof.

## Plan

1. Make the hosted-local Linq activation fixture match the real web activation dispatch identity contract.
2. Re-run the direct and webhook hosted-local Linq E2Es to see whether the continuity failure remains.
3. If the failure remains, trace the exact divergence and fix it with focused regression coverage.
4. Query current Cloudflare logs separately so old deploy noise is not mistaken for the current bug.

## Outcome

- The real product bug was the hosted Linq webhook storage sanitization rewriting `data.from`, which broke active-member reply continuity after the first inbound text.
- Fix landed by preserving `data.from` for the active-member hosted dispatch payload while still redacting the rest of the Linq handles and omitting `recipient_phone`.
- The remaining local webhook rapid-turn failure was not a runtime bug. The new webhook E2E stub only modeled the first-turn reply, so the second-turn prompt path was producing a false negative. Aligning that stub with the existing direct/Telegram rapid-turn fixtures removed the spurious failure.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-contact-privacy.test.ts --no-coverage`
- `env -u NODE_OPTIONS -u MURPH_DEV_CF_WRANGLER_LOG_LEVEL MURPH_DEV_SKIP_RUNNER_BUNDLE=1 MURPH_E2E_STREAM_DEV_LOGS=1 MURPH_E2E_DEBUG_PROGRESS=1 pnpm --dir /Users/willhay/startup1/murph exec vitest run --config apps/cloudflare/vitest.e2e.config.ts apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts --no-coverage`

Both pass. The signed webhook E2E now shows `assistantDeliveryEffectCount: 1` / `assistantDeliveryOutcomeCount: 1` for both rapid turns.
Status: completed
Updated: 2026-04-17
Completed: 2026-04-17
