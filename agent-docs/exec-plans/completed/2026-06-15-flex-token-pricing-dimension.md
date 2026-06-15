# Flex Token Pricing Dimension

## Goal

Persist and price a provider/model-specific token pricing basis so OpenAI flex runs are charged against allowance at the intended discounted rate instead of the standard token table.

## Constraints

- Keep the primitive scoped to token pricing, not a generic turn flag.
- Emit the flex basis only after provider/model routing proves the run is eligible for OpenAI flex.
- Preserve standard pricing for Anthropic, non-OpenAI routes, retries, and legacy records.
- Keep the shape extensible for future token pricing bases such as batch without adding speculative billing behavior.
- Do not weaken hosted usage, allowance, or persisted-state invariants.

## Working Set

- `packages/hosted-execution/src/assistant-usage.ts`
- `packages/assistant-engine/src/assistant/providers/types.ts`
- `packages/assistant-engine/src/assistant/service-usage.ts`
- `packages/assistant-engine/src/assistant/codex-turn-runner.ts`
- `apps/web/prisma/schema.prisma`
- `apps/web/prisma/migrations/*`
- `apps/web/src/lib/hosted-execution/usage.ts`
- `apps/web/src/lib/hosted-execution/usage-allowance.ts`
- Matching focused tests

## Verification Plan

- Focused assistant-engine tests proving flex basis is OpenAI-route-specific and retry-safe.
- Focused hosted-execution allowance tests proving flex token rows price at 50% while standard rows remain unchanged.
- Scoped `pnpm test:diff` over changed hosted usage, assistant runtime, and billing files.
- Required typecheck and completion audits for billing/runtime persisted-state changes.

## Outcome

- Added `tokenPricingBasis` to hosted usage records and `hosted_ai_usage`, defaulting legacy/missing records to `standard`.
- Added provider/model-specific pricing-basis config for `gpt-5.5` so OpenAI flex rows use a 1/2 token-price multiplier.
- Kept flex provider-specific: only OpenAI provider ids (`openai`, `hosted-openai`) can emit or consume `openai-flex`; non-OpenAI providers stay standard or fail closed if a flex row is forged.
- Made `tokenPricingBasis` part of immutable usage-row replay comparison.
- Added tests for parsing/defaults, hosted OpenAI alias handling, provider extraction, web pricing, DB migration shape, persistence handoff, and immutable replay mismatch.
- Completion audits ran: security/privacy found no medium-or-higher issue; coverage-write added missing persistence/replay proof; deep-review found and fixed the `hosted-openai` production alias gap; targeted rerun found no unresolved accepted/actionable findings.
- Verification passed: focused vitest suites, `pnpm typecheck`, and `pnpm test:diff`. `pnpm verify:acceptance` had earlier timeout-only failures in CLI coverage targets; both exact failed coverage targets passed on direct rerun.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
