# Hosted Telegram Ingress

Status: completed
Created: 2026-03-28
Updated: 2026-03-28

## Goal

Implement the smallest hosted Telegram ingress path: one shared bot webhook in `apps/web`, one Telegram identity linked onto `HostedMember`, one hosted execution event `telegram.message.received`, and runtime reuse of the existing Telegram normalization and capture flow.

## Success criteria

- `HostedMember` stores one Telegram identity (`telegramUserId`, `telegramUsername`) with migration support.
- Hosted settings can sync a Privy-linked Telegram account onto the current hosted member without hot-path Privy lookups during webhook intake.
- `apps/web` exposes a public Telegram webhook route that validates the configured secret, accepts only direct/private Telegram chats for already-linked members, and enqueues hosted execution dispatches through the existing outbox flow.
- Shared hosted execution contracts parse and build `telegram.message.received` events.
- `packages/assistant-runtime` reuses the inbox Telegram normalization path so webhook dispatches persist captures and continue through the normal hosted maintenance loop.
- Focused tests cover contract parity, hydration/dispatch behavior, webhook routing, and runner persistence for the new event path.

## Scope

- In scope:
  - `apps/web` Prisma, hosted onboarding routes/helpers, hosted settings UI, and focused tests
  - shared hosted execution contract changes
  - targeted hosted runtime support and Cloudflare runner proof
- Out of scope:
  - Telegram polling in hosted runtimes
  - per-user Telegram bot tokens
  - auto-onboarding unmatched Telegram users
  - non-direct Telegram chats or broader Telegram product changes

## Constraints

- Keep the implementation webhook-only.
- Reuse the existing Telegram normalization path instead of adding a second Telegram capture pipeline.
- Preserve adjacent dirty-tree work in hosted email/settings, webhook receipts, and assistant-runtime files.
- Keep the first implementation intentionally narrow: direct/private chats only, linked members only, unmatched users ignored.

## Risks

1. Overlapping hosted onboarding/settings edits could be clobbered if current file state is not merged carefully.
2. Hosted execution contract drift could break parsing/building symmetry between `apps/web` and Cloudflare runtime consumers.
3. A webhook ingress bug could let unlinked or non-private Telegram traffic enqueue hosted runs.

## Plan

1. Inspect the current hosted onboarding/settings/runtime surfaces and the provided patch against the live tree.
2. Land the Prisma, hosted settings, and webhook ingress changes in `apps/web`.
3. Extend the shared hosted execution contract and hosted runtime for `telegram.message.received`.
4. Add or merge focused tests proving dispatch, hydration, webhook routing, and runner capture persistence.
5. Run required verification plus direct scenario checks, then complete the mandatory simplify, coverage, and finish-review audit passes before handoff.

## Verification

- Focused while iterating:
  - `pnpm exec vitest run apps/web/test/hosted-onboarding-telegram-dispatch.test.ts apps/web/test/hosted-execution-contract-parity.test.ts apps/web/test/hosted-execution-hydration.test.ts apps/cloudflare/test/node-runner.test.ts packages/hosted-execution/test/hosted-execution.test.ts --no-coverage --maxWorkers 1`
- Required repo checks before handoff:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`

## Progress

- Done:
  - reviewed repo guardrails, hosted onboarding/runtime docs, and the provided Telegram ingress patch
  - mapped the overlap with the current dirty tree
  - landed the hosted Telegram webhook, hosted member linkage, hosted execution contract, hosted runtime, and settings UI updates
  - added focused Telegram route, dispatch, hydration, runtime, and settings regressions
  - captured a direct scenario proof showing a webhook-style `telegram.message.received` dispatch restores a persisted direct Telegram capture
  - completed the mandatory simplify, test-coverage, and final review audit passes and applied follow-up fixes
  - reran required verification after the audit fixes
- Now:
  - task complete
- Next:
  - none
Completed: 2026-03-28
