# 2026-03-30 Hosted Email Sender Auth Hardening

## Goal

- Close the hosted email alias trust-boundary gap so knowing another member's alias address is not enough to inject inbound mail into that member's hosted assistant or vault context.

## Scope

- `ARCHITECTURE.md`
- `apps/cloudflare/src/index.ts`
- `apps/cloudflare/test/index.test.ts`
- `packages/runtime-state/src/hosted-email.ts`
- `packages/runtime-state/test/hosted-email.test.ts`
- `packages/inboxd/src/connectors/email/parsed.ts`
- `packages/inboxd/src/index.ts`
- `packages/assistant-runtime/src/hosted-runtime/events.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/email.ts`
- `packages/assistant-runtime/test/hosted-runtime-http.test.ts`
- `agent-docs/exec-plans/active/{2026-03-30-hosted-email-sender-auth-hardening.md,COORDINATION_LEDGER.md}`

## Findings

- Phone and Telegram hosted ingress already bind inbound traffic through authenticated provider webhooks plus unique hosted-member identifiers before selecting a user and vault.
- Hosted email ingress resolved only the recipient alias route and then stored and dispatched the raw message for that user without authorizing the sender against either the member's synced verified email or any saved thread participants.
- That meant anyone who learned a member's hosted alias could potentially inject inbound email into that member's hosted runtime and, if automation replied, receive vault-derived output on the attacker-controlled thread.
- Follow-up audit found two narrower spoofing gaps in the first pass: ambiguous or mismatched `From:` values could still pass if the envelope sender aligned poorly, and duplicate raw `From:` headers were being flattened by the email parser before authorization.

## Constraints

- Preserve the existing alias formats, route-token parsing, per-user raw-message storage keys, and reply-thread participant semantics.
- Fail closed when there is no trusted verified email and no saved thread participant set for the addressed route.
- Keep the change narrow to sender authorization and regression coverage; do not redesign hosted email UX or broader onboarding flows.

## Plan

1. Add shared hosted-email sender-authorization helpers that normalize verified-email and thread-participant allowlists.
2. Enforce sender authorization in Cloudflare email ingress before writing raw messages or dispatching hosted events.
3. Enforce the same authorization again inside hosted runtime email ingestion as defense in depth for any bad or replayed dispatch event.
4. Fail closed on ambiguous, mismatched, or duplicate raw `From:` headers before sender authorization.
5. Add focused Cloudflare, runtime-state, and assistant-runtime regressions for allowed verified-email delivery and rejected spoofed, non-owner, or non-participant senders.
6. Update architecture docs so the hosted email trust boundary is explicit next to the other hosted channel rules.

## Verification

- Pending required repo checks plus focused direct scenario proof for authorized and unauthorized hosted email ingress.
Status: completed
Updated: 2026-03-30
Completed: 2026-03-30
