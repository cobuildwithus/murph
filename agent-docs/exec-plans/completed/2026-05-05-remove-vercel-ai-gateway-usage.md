# Remove Vercel AI Gateway usage tracking

Status: completed
Created: 2026-05-05
Updated: 2026-05-05

## Goal

- Disable and remove the Vercel AI Gateway usage-tracking path now that hosted execution no longer uses Vercel AI Gateway.

## Success criteria

- Hosted runtime still exports assistant token usage to the hosted web usage-record route so Murph-owned `HostedAiUsage` rows are stored in Postgres.
- Pending assistant usage records only accept `stripeMeterSource=murph`; non-Murph meter sources fail closed instead of being normalized.
- Delegated Vercel AI Gateway Stripe customer lookup, execution-context customer propagation, and delegated-row import behavior are removed.
- Docs and focused tests no longer describe Vercel AI Gateway delegated usage metering as active behavior.

## Scope

- In scope:
  - `packages/runtime-state/src/assistant-usage.ts`
  - `packages/assistant-engine/src/assistant/provider-turn-runner.ts`
  - `packages/assistant-engine/src/assistant/usage-attribution.ts`
  - `packages/assistant-runtime/src/hosted-runtime/billing.ts`
  - `packages/assistant-runtime/src/hosted-runtime/platform.ts`
  - `apps/cloudflare/src/runtime-platform.ts`
  - `apps/cloudflare/src/runner-outbound/shared-web-control-policy.ts`
  - `apps/web/src/lib/hosted-execution/usage.ts`
  - focused tests/docs for those surfaces
- Out of scope:
  - Removing Vercel hosting, Vercel OIDC, Vercel cron auth, analytics, or deployment config.
  - Removing the hosted AI usage database tables in this turn.
  - Reworking hosted product billing or Stripe checkout plans beyond deleting the gateway-delegated metering path.

## Constraints

- Preserve unrelated dirty work already present in hosted web, Cloudflare, assistant-runtime, docs, and Health Commons files.
- Do not print or persist secrets, raw Authorization headers, prompts, transcripts, provider responses, local account names, or home-directory paths.
- Do not add compatibility normalization for old Vercel meter payloads.

## Risks and mitigations

1. Risk: Removing the wrong export path could stop Murph-owned Postgres usage rows.
   Mitigation: Keep the Cloudflare-to-web usage record export port and disable allowance pricing during import.
2. Risk: Over-deleting Vercel platform code could break hosted web-to-worker auth, cron, or deployment.
   Mitigation: Limit edits to AI Gateway usage/metering symbols and explicit usage record paths.
3. Risk: Old Vercel-meter payloads might still arrive.
   Mitigation: Reject non-Murph meter sources during runtime-state parsing instead of mapping them into Murph usage.

## Tasks

1. Register the task and inspect overlapping usage/hosted-provider work.
2. Remove runtime delegated gateway usage attribution and billing lookup.
3. Keep hosted usage export to web, but remove Gateway customer lookup and delegated Stripe billing context.
4. Update web import/runtime-state tests and docs to Murph-only usage metering.
5. Run focused verification and report any unrelated blockers.

## Decisions

- Do not remove generic hosted AI allowance tables in this task; this request is about the Vercel AI Gateway usage-tracking path.
- Keep `stripeMeterSource` storage as a string column for DB compatibility, but narrow parsed pending/imported usage records to `murph` and reject non-Murph sources.

## Verification

- `pnpm exec vitest run test/assistant-usage.test.ts test/assistant-usage-path.test.ts --no-coverage` from `packages/runtime-state` passed.
- `pnpm exec vitest run test/assistant-usage-attribution-and-scheduled-log.test.ts test/assistant-service-runtime.test.ts --no-coverage` from `packages/assistant-engine` passed.
- `pnpm exec vitest run test/hosted-runtime-platform.test.ts test/hosted-runtime-workspace-assistant-phase.test.ts test/hosted-runtime-system-mailbox-notification.test.ts --no-coverage` from `packages/assistant-runtime` passed.
- `pnpm exec vitest run --config vitest.node.workspace.ts test/runner-platform.test.ts test/runner-outbound.test.ts test/hosted-env-policy.test.ts test/deploy-automation.test.ts test/runner-env.test.ts --no-coverage` from `apps/cloudflare` passed.
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-execution-usage.test.ts apps/web/test/hosted-execution-usage-route.test.ts apps/web/test/hosted-execution-usage-allowance.test.ts --no-coverage` passed.
- Targeted typechecks passed for `@murphai/runtime-state`, `@murphai/assistant-engine`, `@murphai/assistant-runtime`, `@murphai/cloudflare-runner`, and `@murphai/hosted-web` using their package scripts.
- `pnpm typecheck` was blocked by an unrelated generated `apps/cloudflare/.deploy/worker-bundle.mjs` hosted-crypto guard failure.
- `git diff --check` passed.
- Privacy scan of this task's diff passed.
Completed: 2026-05-05
