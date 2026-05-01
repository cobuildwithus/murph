# Hosted Runner Nudge Drain Simplification

## Goal

Land the supplied greenfield runner simplification so `nudgeHostedRunner()` remains the only writer of `pending_nudge`, active invocations only sync recovery alarms, alarms act as due-wake recovery, and follow-up nudges are drained immediately in a bounded loop after invocation completion.

## Constraints

- Preserve the current no-queue hosted runner architecture.
- Keep Cloudflare Durable Object state as short-lived execution coordination only.
- Do not widen into hosted web wake contracts, assistant-runtime turn handling, or device-sync behavior.
- Preserve unrelated active hosted-runtime, Cloudflare, web, and assistant-engine work.

## Plan

1. Port the supplied patch onto current `apps/cloudflare/src/user-runner.ts`.
2. Update focused alarm/runner tests and worker test helpers for stale alarm and follow-up drain behavior.
3. Run focused Cloudflare verification first, then required repo verification.
4. Review privacy/security and diff scope before commit.

## Verification

- `pnpm exec vitest run apps/cloudflare/test/user-runner-alarm.test.ts --config apps/cloudflare/vitest.node.workspace.ts --project cloudflare-node-platform --no-coverage` passed with 32 tests.
- `pnpm --dir apps/cloudflare test:workers` passed with no tests found.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts apps/cloudflare/test/workers/worker-entry.ts` failed in `apps/cloudflare verify` on unrelated dirty-checkout missing import `@murphai/hosted-local-harness/compat` from `apps/cloudflare/scripts/run-hosted-local-e2e.ts`.
- `pnpm typecheck` failed on the same unrelated hosted-local harness import.
- Security/privacy review: no findings.
- Coverage-write review: added one budget-continuation regression and focused verification passed.
- Final completion review: no findings.

## Status

Completed. Scoped commit uses the runner files and this archived plan only because the coordination ledger has overlapping unrelated active-row edits.
