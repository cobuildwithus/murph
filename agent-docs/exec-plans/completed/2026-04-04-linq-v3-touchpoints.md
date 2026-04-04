# 2026-04-04 Linq V3 Touch Points

## Goal

Hard-cut Murph's Linq integration onto the current Partner API v3 surface and the active webhook version `2026-02-03`, including the greenfield-required chat-creation and webhook-subscription touch points already needed by the existing stack.

## Why

- The active hosted onboarding webhook is configured on v3 with webhook version `2026-02-03`, but current parsing assumes the legacy `2025-01-01` message shape.
- Existing Linq phone-number probes still use deprecated `/phonenumbers` instead of `/v3/phone_numbers`.
- Current shared parsing/minimization still had legacy assumptions that break raw `2026-02-03` webhook capture and leave nested phone-number handles unsanitized in hosted storage snapshots.
- Existing outbound send touch points needed current v3 idempotency support, and the stack still lacked the greenfield `POST /v3/chats` and `POST /v3/webhook-subscriptions` helpers.

## Scope

- Shared Linq webhook parsing and minimization in `packages/messaging-ingress`
- Local Linq runtime/probe helpers in `packages/assistant-core`
- Hosted Linq control-plane and onboarding handlers in `apps/web`
- Existing Linq-focused tests across `apps/web`, `packages/messaging-ingress`, `packages/inboxd`, and `packages/cli`

## Constraints

- Do not preserve legacy Linq payload compatibility; the user requested a hard greenfield cut.
- Keep scope to Linq API alignment and required existing operational touch points rather than building new onboarding products or flows on top.
- Preserve current hosted onboarding and local reply behavior where the latest v3 API still supports it.
- Preserve unrelated dirty-tree edits and active lanes already in progress.

## Planned Shape

1. Replace legacy webhook assumptions with the `2026-02-03` message payload shape across parsing, normalization, and minimization.
2. Update Linq summary/minimization helpers so hosted and local consumers can operate on the normalized latest shape without leaking nested handles.
3. Switch Linq phone-number probes from deprecated `/phonenumbers` to `/phone_numbers`.
4. Add the missing greenfield v3 helper touch points for `POST /v3/chats` and `POST /v3/webhook-subscriptions`, and propagate idempotency keys through existing sends.
5. Refresh focused tests to cover the latest webhook version and current endpoint paths.
6. Run focused Linq verification plus repo typecheck.

## Outcome

- Shared Linq parsing, canonicalization, and minimization now hard-cut to the `2026-02-03` webhook shape and no longer expect nested `data.message` on raw events.
- Hosted storage sanitization now redacts nested handle objects including `sender_handle`, `recipient_handle`, `from_handle`, and `chat.owner_handle`.
- Hosted/runtime timestamp validation now reports `sent_at` correctly for malformed current-version payloads.
- Existing outbound message sends now include Linq `message.idempotency_key` support.
- The stack now exposes the missing greenfield helper touch points for `POST /v3/chats` and `POST /v3/webhook-subscriptions`.
- Focused Linq tests and repo-wide `pnpm typecheck` passed after the test typing fix in `apps/web/test/hosted-onboarding-linq-http.test.ts`.

## Verification

- Focused Linq Vitest coverage in `apps/web`
- Focused Linq/shared runtime Vitest coverage in `packages/messaging-ingress`, `packages/inboxd`, and `packages/cli`
- `pnpm typecheck`
Status: completed
Updated: 2026-04-04
Completed: 2026-04-04
