# 2026-03-28 Telegram Hosted Parity Cleanup

## Goal

- Make hosted Telegram intake reuse the same stateless message-model and routing rules as local polling, reduce duplicated target parsing, and add parity regressions for the supported Telegram paths that previously only local/outbound tests covered.

## Scope

- `agent-docs/exec-plans/active/{2026-03-28-telegram-hosted-parity-cleanup.md,COORDINATION_LEDGER.md}`
- `packages/inboxd/src/connectors/telegram/{normalize.ts,target.ts,connector.ts}`
- `packages/inboxd/test/telegram-connector.test.ts`
- `packages/cli/src/{telegram-runtime.ts,inbox-services/connectors.ts,assistant/channel-adapters.ts,inbox-app/types.ts}`
- targeted `packages/cli/test/{assistant-channel.test.ts,inbox-cli.test.ts}`
- `packages/hosted-execution/src/{contracts.ts,builders.ts,parsers.ts}`
- `packages/hosted-execution/test/hosted-execution.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/telegram.ts`
- `apps/web/src/lib/hosted-onboarding/{telegram.ts,webhook-provider-telegram.ts,webhook-receipt-dispatch.ts}`
- targeted `apps/web/test/{hosted-onboarding-telegram-dispatch.test.ts,hosted-execution-contract-parity.test.ts,hosted-execution-hydration.test.ts}`

## Findings

- `apps/web` still duplicates Telegram message extraction, direct-thread detection, and self/actor summarization even though `packages/inboxd` already owns the canonical local logic.
- Hosted Telegram dispatches do not currently carry bot identity, so hosted runtime cannot fully normalize Telegram captures the same way as local polling.
- `TelegramThreadTarget` is already the canonical routing grammar, but CLI internals still route through local wrapper aliases and repeated parse/format steps.
- Local polling behavior explicitly takes over the mutually exclusive Telegram polling transport by deleting any existing webhook on start, but the API surface still exposes this as a Telegram-specific boolean instead of a transport decision.

## Constraints

- Preserve the separate trust boundaries: webhook verification/member lookup stays in `apps/web`, while capture normalization/persistence stays in `packages/assistant-runtime`.
- Do not collapse hosted identity linkage onto Telegram thread-routing data; member identity and reply routing remain separate axes.
- Preserve adjacent dirty edits in overlapping hosted-onboarding and CLI files, and keep this lane scoped to Telegram cleanup plus direct regressions only.

## Plan

1. Export or factor the canonical Telegram stateless message-model helpers in `packages/inboxd` so hosted onboarding and hosted runtime can consume the same direct/self/actor/target logic.
2. Extend hosted Telegram dispatch contracts with bot identity metadata, then thread it through webhook planning, hydration, and hosted runtime ingestion.
3. Simplify CLI Telegram routing so `TelegramThreadTarget` remains the single internal routing grammar, with string parsing/serialization limited to persistence and Bot API boundaries.
4. Replace the implicit Telegram webhook-reset boolean with an explicit poll transport mode and keep local polling behavior unchanged.
5. Add parity regressions for business-account self traffic, direct-message topics, malformed secret-bearing payloads, malformed target strings, and the explicit transport-mode behavior.
6. Run focused verification, a direct scenario proof for hosted Telegram planning/normalization, then the required simplify, coverage, and final-review audit passes.

## Verification

- `pnpm --dir apps/web typecheck` -> fails in existing unrelated hosted-onboarding work (`billing-service.ts`, `webhook-provider-linq.ts`, `webhook-provider-stripe.ts`); Telegram-specific receipt import/export errors were removed by this cleanup.
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-telegram-dispatch.test.ts apps/web/test/hosted-execution-contract-parity.test.ts apps/web/test/hosted-execution-hydration.test.ts --no-coverage --maxWorkers 1`
- `pnpm --dir packages/cli typecheck`
- `pnpm exec vitest run --config .tmp-vitest-telegram-cli.mts packages/cli/test/assistant-channel.test.ts packages/cli/test/inbox-service-boundaries.test.ts --no-coverage --maxWorkers 1`
- `pnpm exec vitest run packages/hosted-execution/test/hosted-execution.test.ts --no-coverage --maxWorkers 1`
- `pnpm exec vitest run --config packages/inboxd/vitest.config.ts packages/inboxd/test/telegram-connector.test.ts packages/inboxd/test/telegram-target.test.ts --no-coverage --maxWorkers 1`
- `pnpm typecheck` -> fails in existing unrelated `packages/core` / `packages/runtime-state` workspace state and retry-time build artifact cleanup.
- `pnpm test` -> fails in existing unrelated concurrent `next build` state under `packages/web`.
- `pnpm test:coverage` -> fails in existing unrelated `apps/web` type errors outside the Telegram cleanup scope.
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
