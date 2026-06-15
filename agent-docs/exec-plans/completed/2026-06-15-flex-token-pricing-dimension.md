# Flex Token Pricing Dimension

## Goal

Add a composable token-pricing basis for hosted AI usage and prove cron automation accounting matches the provider request tier.

## Constraints

- Flex pricing is model/provider-specific and must fail closed to standard pricing unless the provider request path proves flex was actually used.
- Keep the primitive reusable for future pricing axes such as batch pricing.
- Exercise hosted cron automation through the real hosted-local Codex runner path; stub only external provider, clock/alarm, delivery, and secret edges needed for deterministic local E2E.
- Preserve existing standard allowance pricing behavior.

## Working Set

- `packages/hosted-execution/src/runtime-control.ts`
- `packages/assistant-engine/src/assistant/providers/helpers.ts`
- `apps/web/src/lib/hosted-execution/usage-allowance.ts`
- `apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts`
- `apps/web/test/hosted-execution-usage-allowance.test.ts`
- `packages/assistant-engine/test/codex-runtime-helpers.test.ts`
- `packages/hosted-execution/test/hosted-runtime-control.test.ts`
- `docs/contracts/00-invariants.md`

## Verification Plan

- Focused unit tests for token-pricing basis resolution and allowance pricing.
- Hosted-local Linq scheduled reminder E2E proving cron usage rows match the actual Codex-emitted provider request tier.
- Required `pnpm typecheck`, `pnpm test:diff`, and ReviewGPT loop before handoff.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
