## Goal

Diagnose and fix the hosted onboarding/iMessage reply failure without regressing Telegram or hosted execution reliability.

## Why

- Post-redeploy Linq ingress succeeds, but the phone/iMessage member still does not receive the outbound reply.
- Production data shows split hosted members for Telegram vs phone identities, so routing and send behavior both need verification.

## Scope

- `apps/cloudflare/src/**`
- `apps/web/src/lib/hosted-onboarding/**`
- `packages/assistant-runtime/src/hosted-runtime/**`
- `packages/assistant-engine/src/assistant/**`
- `packages/operator-config/src/**`
- Focus on hosted Linq reply delivery and identity/channel resolution only.

## Guardrails

- Preserve unrelated hosted onboarding and runtime work already in flight.
- Do not print or persist secrets or raw personal identifiers.
- Prefer the smallest fix that matches the observed production evidence.

## Verification target

- Truthful scoped checks for touched owners plus direct log/database evidence for the hosted Linq reply path.

## Current hypothesis

- Hosted Linq ingress stores a privacy-scrubbed webhook payload where `message.id` is rewritten to an opaque `hbid:` token.
- Hosted runtime later normalizes that scrubbed payload into the inbox capture and uses the opaque token as the conversation `externalId`.
- Auto-reply threading then strips the `linq:` prefix and sends the opaque token back to Linq as `reply_to.message_id`, which reproduces the observed `POST /chats/.../messages` HTTP `400`.

## State

- Root cause reproduced directly against the live Linq API: the target chat accepts plain sends, but returns `400` when `reply_to.message_id` is invalid.
- Narrow fix implemented in `packages/assistant-runtime/src/hosted-runtime/events/linq.ts` to preserve the real `dispatch.event.linqMessageId` for capture `externalId`.
- Recovery hardening implemented in `packages/assistant-engine/src/assistant/automation/reply.ts` so persisted opaque hosted `hbid:` ids are dropped instead of retried as Linq `reply_to` anchors.
- Regression coverage added in:
  - `packages/assistant-runtime/test/hosted-runtime-linq-event.test.ts`
  - `packages/assistant-engine/test/assistant-automation-runtime.test.ts`

## Verification status

- `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-linq-event.test.ts --no-coverage`
- `pnpm --dir packages/assistant-runtime test:coverage`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir packages/assistant-engine exec vitest run test/assistant-automation-runtime.test.ts --no-coverage`
- `pnpm --dir packages/assistant-engine test:coverage`
- `pnpm --dir packages/assistant-engine typecheck`
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
