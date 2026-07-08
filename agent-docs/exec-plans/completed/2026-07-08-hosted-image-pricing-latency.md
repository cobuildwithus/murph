# Hosted Image Pricing And Direct Wake Latency Triage

## Goal

Fix the production hosted AI usage-record 400s caused by generated-image records using an unpriced image model, and identify the root cause of the direct-wake latency Prisma warning without exposing user data.

## Constraints

- Ignore retention-cron inactive-user errors for this task.
- Use official OpenAI pricing as the source for image generation token rates.
- Keep pricing changes scoped to hosted usage allowance accounting; do not broaden hosted billing or runtime state.
- Use production-safe DB metadata only for latency triage; do not select or quote raw user identifiers, message text, secrets, or credentials.
- Preserve existing hosted wake delivery behavior; latency timing failures must remain non-blocking.

## Working Set

- `packages/hosted-execution/src/runtime-control.ts`
- `packages/hosted-execution/test/hosted-runtime-control.test.ts`
- `apps/web/src/lib/hosted-execution/usage-allowance.ts`
- `apps/web/test/hosted-execution-usage-allowance.test.ts`
- `apps/web/src/lib/hosted-runtime-latency/store.ts`
- `apps/web/test/hosted-runtime-latency-store.test.ts`

## Plan

1. Add an explicit generated-image priced-model primitive for `gpt-image-2`.
2. Price OpenAI image usage from usage detail tokens using standard image-generation rates.
3. Add focused tests for the image pricing path and model normalization.
4. Query DB metadata and inspect latency store code to explain the direct-wake Prisma warning.
5. Run focused tests plus required typecheck/diff verification, then finish the active plan with a scoped commit.

## Verification

- Focused hosted-execution runtime-control tests.
- Focused hosted usage allowance tests.
- Focused latency store tests if latency code changes.
- `pnpm typecheck`
- `pnpm test:diff` over touched files.

## State

Complete. `gpt-image-2` OpenAI image usage is priced explicitly for hosted usage allowance accounting, and direct-wake latency trace recording now tolerates the observed mailbox-item upsert race by returning the concurrently created trace.

## Outcomes

- Added a separate generated-image priced-model primitive so image pricing does not expand the hosted assistant deploy preflight model set.
- Added standard OpenAI image token pricing for `openai.images.generate` / `openai.images.edit` records with explicit text, image, cached, and output token buckets.
- Verified production metadata for the log window: latency phase breakdown rows existed for sampled direct-wake traces, so the warning was not caused by a missing column or absent migration.
- Hardened latency trace upsert handling for the mailbox-item unique race observed in after-response timing.
- Verification passed: focused hosted-execution tests, focused web usage-allowance tests, focused latency-store tests, full `pnpm typecheck`, and affected `pnpm test:diff`.
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
