# Hosted AI usage one-shot notice

Status: completed
Created: 2026-05-06
Updated: 2026-05-06

## Goal

- Make hosted AI usage-limit outbound notifications one-shot, and make quota notice copy put `https://withmurph.ai/home` at the end of the message.

## Success criteria

- Hosted Linq sends at most one AI usage-limit notice for a member's usage period.
- Later Linq messages blocked by the same usage period are ignored instead of sending another quota notice.
- AI usage-limit notice messages end with `https://withmurph.ai/home`.
- Focused hosted-web tests cover the notice claim and copy behavior.

## Scope

- In scope:
  - Hosted AI usage allowance period state.
  - Hosted Linq usage-gate notification planning and transport tests.
  - Prisma schema/migration for the one-shot notice claim.
- Out of scope:
  - Changing usage pricing, allowance accounting, Stripe metering, or Cloudflare runner gating.
  - Changing daily Linq text quota behavior.

## Constraints

- Technical constraints:
  - Preserve existing usage gate decisions for Cloudflare status; only outbound Linq notification sending becomes one-shot.
  - Keep the claim transaction-bound and idempotent.
- Product/process constraints:
  - Preserve privacy guardrails and avoid logging raw user content or identifiers.
  - Coordinate with active hosted usage metadata work and keep the write set narrow.

## Risks and mitigations

1. Risk: Claiming the notice before send can suppress a retry if provider delivery fails.
   Mitigation: This satisfies the one-time-max requirement and matches the stricter duplicate prevention behavior requested.
2. Risk: Schema overlap with active hosted usage metadata work.
   Mitigation: Add one additive nullable field and one focused migration, and do not touch unrelated usage metadata fields.

## Tasks

1. Done: Add an additive usage-period notice-sent field and migration.
2. Done: Add a claim helper in hosted usage allowance logic.
3. Done: Gate Linq AI usage quota replies on that claim.
4. Done: Update notice copy and focused tests.
5. Done: Run required checks and completion audits.

## Decisions

- Use a nullable timestamp on `HostedAiUsagePeriod` so the one-shot behavior is scoped to the billing/allowance period rather than to one inbound event or one UTC day.
- Return the existing generic `ai-usage-gate-denied` ignored reason when the one-shot notice is already claimed, so webhook responses/log reasons do not reveal whether the member had already received the notice.

## Verification

- Commands to run:
  - `pnpm test:diff apps/web/src/lib/hosted-execution/usage-allowance.ts apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts apps/web/src/lib/hosted-onboarding/webhook-transport.ts apps/web/prisma/schema.prisma apps/web/prisma/migrations/2026050601_hosted_ai_usage_limit_notice_sent/migration.sql apps/web/test/hosted-execution-usage-allowance.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-linq-transport.test.ts apps/web/test/hosted-execution-usage-gate-route.test.ts`
  - `pnpm typecheck`
- Expected outcomes:
  - Focused hosted-web coverage passes.
  - Typecheck passes, or any unrelated existing blocker is recorded precisely.
- Results:
  - `pnpm --dir apps/web test -- test/hosted-execution-usage-allowance.test.ts test/hosted-onboarding-linq-dispatch.test.ts test/hosted-onboarding-linq-transport.test.ts test/hosted-execution-usage-gate-route.test.ts test/dashboard-home-page.test.tsx test/hosted-onboarding-privacy-foundation-migration.test.ts` passed after the security/privacy fix (225 files, 1616 tests).
  - `pnpm --dir apps/web verify` passed.
  - `pnpm typecheck` failed in unrelated `packages/assistant-runtime/src/hosted-runtime/events.ts` missing timing-trace symbols from active work outside this plan.
  - `pnpm test:diff ...` failed twice before the hosted-web branch because unrelated `apps/cloudflare/test/container-entrypoint.test.ts > rejects oversized invocation requests before parsing JSON` hit `ECONNRESET`.
  - `security-privacy-review` found one low disclosure issue in the repeat-suppression reason; fixed by returning the generic usage-gate-denied reason.
  - `coverage-write` found no worthwhile additional tests; no files changed by that worker.
Completed: 2026-05-06
