# Telegram Delivery Runtime Logs

## Goal

Add targeted hosted-runtime logging around Telegram typing startup and committed assistant-delivery side effects so live Cloudflare traces can pinpoint post-generation delivery failures.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/{callbacks,execution,typing}.ts`
- `packages/assistant-runtime/test/hosted-runtime-{callbacks,execution,typing}.test.ts`

## Guardrails

- Log only booleans, counts, statuses, and internal ids; never raw secrets or Telegram target ids.
- Do not change delivery behavior, only instrumentation and matching tests.
- Preserve unrelated active work in the repo.

## Verification

- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-callbacks.test.ts test/hosted-runtime-typing.test.ts test/hosted-runtime-execution.test.ts --no-coverage`
- Attempt broader checks and note unrelated blockers if they fail outside this diff.
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
