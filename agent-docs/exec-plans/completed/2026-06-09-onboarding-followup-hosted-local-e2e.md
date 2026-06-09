# Hosted Local Onboarding Follow-Up E2E

## Goal

Add a hosted-local E2E test proving the signup onboarding follow-up lifecycle without adding production test seams:

- Signup welcome delivery seeds the `finish-onboarding-followup` automation.
- The reminder can be accelerated through existing automation primitives.
- The scheduled hosted alarm fires the reminder through the normal Linq/provider/outbox path.
- After onboarding is complete, the next scheduled period self-archives and does not send again.

## Scope

- `apps/cloudflare/test/hosted-local-onboarding-followup-e2e.test.ts`
- `packages/hosted-local-harness/src/e2e.ts`
- `packages/hosted-local-harness/src/codex-app-server-stub.ts`
- `apps/cloudflare/test/run-hosted-local-e2e-runner.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/events.ts`
- `packages/assistant-runtime/test/hosted-runtime-events.test.ts`
- `packages/assistant-engine/src/assistant/cron/targets.ts`
- `packages/assistant-engine/test/assistant-cron-runtime.test.ts`
- Minimal test-harness-only support only if required by existing E2E model response directives.

## Constraints

- No production source hooks, fake runtime branches, new scheduler, or new product state.
- Reuse existing hosted-local stack, Linq stub, provider stub, mailbox append, workspace checkpoint, and alarm invocation primitives.
- Preserve existing onboarding follow-up architecture: canonical automation plus assistant cron runtime state.
- Keep diagnostics redacted and metadata-only.

## Plan

1. Inspect current hosted-local scheduled reminder and signup welcome flows.
2. Add a narrow E2E scenario that uses production APIs and existing test harness primitives.
3. Register it as an isolated hosted-local scenario.
4. Run the focused scenario plus registry/unit checks and typecheck.
5. Run required completion audits, then close this plan with `scripts/finish-task`.

## Verification

Completed:

- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-cron-runtime.test.ts --no-coverage`
- `pnpm --filter @murphai/hosted-local-harness test -- codex-app-server-stub.test.ts`
- `pnpm hosted-local e2e linq-onboarding-followup`
- `pnpm test:diff`
Status: completed
Updated: 2026-06-09
Completed: 2026-06-09
