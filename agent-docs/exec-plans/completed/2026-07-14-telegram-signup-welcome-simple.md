# Simple Telegram Signup Welcome

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Restore the immediate activation welcome for a Telegram-only signup with the
  smallest architecture that satisfies the current product requirement.
- Treat the Privy-verified Telegram user id as the direct delivery target when
  no inbound Telegram thread exists.

## Constraints

- Prefer `telegramThreadId ?? telegramUserId`; inbound-observed routes remain
  preferred.
- Reuse the existing encrypted member routing record, activation event,
  assistant notification route, mailbox, outbox, and Telegram sender.
- Add no provider probe, bot-bound target grammar, configuration flag, callback,
  queue, state owner, compatibility layer, replay, or cleanup protocol.
- Keep semantic conversation identity and delivery target identical for the
  direct-user-id fallback.
- Preserve unrelated work and the hosted signup timezone lane's changes when
  reconciling with `main`.

## Method

1. Start from current `origin/main` and inspect the original pre-review patch.
2. Make the routing resolver prefer an inbound thread and otherwise use the
   verified Telegram user id.
3. Prevent activation from performing an unnecessary Linq lookup when either
   Telegram target is available.
4. Add only focused tests proving Telegram-only signup readiness and welcome
   delivery-route construction.
5. Run truthful Web verification, required coverage review, parent final review,
   close the plan, commit, push, and open a replacement PR.

## Verification Plan

- Focused hosted onboarding messaging, activation, and Privy service tests.
- `pnpm test:diff` for the exact changed source and test files under the shared
  host profile.
- Required `coverage-write` audit with test-only write scope.
- ReviewGPT and CI on the exact pushed replacement PR head.

## Verification Log

- Shared-host `pnpm test:diff` selected only `apps/web` and passed dependency,
  workspace-boundary, hosted-runtime, Temporal, crypto, and logging guards.
- TypeScript 7 passed with the shared profile.
- Web verification passed 5,047 tests with 139 intentional skips, lint with zero
  errors and 12 unrelated warnings, dev smoke, and the production Next build.
- Required coverage-write audit found no material proof gap and made no edits.
- Parent scope review confirmed the production change is limited to the existing
  routing resolver and activation decision; no new runtime or persisted concept
  was introduced.
Completed: 2026-07-14
