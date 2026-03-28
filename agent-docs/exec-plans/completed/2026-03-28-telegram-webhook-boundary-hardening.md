# 2026-03-28 Telegram Webhook Boundary Hardening

## Goal

Close the reported Telegram trust-boundary and correctness gaps without widening into unrelated onboarding or assistant channel work:

1. Make hosted onboarding classify Telegram self-authored business-account traffic the same way the local connector already does.
2. Reject malformed Telegram webhook payloads earlier so the hosted webhook receipt/outbox path only persists Telegram-shaped updates that satisfy the supported message schema.
3. Prevent local Telegram attachment hydration from reading arbitrary host paths unless Murph is explicitly or implicitly configured for a trusted loopback Local Bot API server.

## Constraints

- Preserve adjacent dirty edits already in `apps/web` and `packages/inboxd`; integrate on top of the live tree instead of reverting overlapping work.
- Keep hosted Telegram webhook auth on the existing secret-header boundary while tightening payload validation and self-message planning.
- Reuse the existing Telegram types and local normalizer semantics where practical instead of introducing a parallel hosted model.
- Keep local polling/file-download support working for trusted loopback Local Bot API setups while failing closed for default or remote custom endpoints.
- Run focused regressions plus the repo-required verification commands and mandated spawned audit passes before handoff.

## Planned Shape

1. Tighten `apps/web` Telegram webhook parsing around supported update/message/user/chat/file shapes so malformed payloads fail before receipt persistence.
2. Expand hosted Telegram webhook summarization to recognize `sender_business_bot` self-authorship and avoid member dispatch for business-account self traffic.
3. Add a local-file trust gate to the Telegram file downloader, with a secure default and loopback-aware allowance for Local Bot API usage.
4. Add focused hosted onboarding and inboxd regressions for the business-message self case, malformed webhook payload rejection, safe local-file reads, and fail-closed remote-path rejection.
5. Run repo verification, then the required simplify, coverage, and final-review audit passes, and close the plan on completion.

## Verification Target

- Focused Vitest coverage for:
  - hosted onboarding Telegram webhook dispatch/self-filtering/validation
  - inboxd Telegram poll-driver file download trust boundaries
- Required repo checks:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`

## Status

- Context gathered from repo docs, the coordination ledger, and the live Telegram hosted/local code paths.
- Implementation completed with targeted Telegram regressions green.
- Repo-wide verification remains blocked by unrelated pre-existing `packages/device-syncd` and `packages/cli` build/type errors in the dirty tree.
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
