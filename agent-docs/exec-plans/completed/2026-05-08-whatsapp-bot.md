# WhatsApp hosted bot ingress

Status: completed
Created: 2026-05-08
Updated: 2026-05-08

## Goal

- Add a first WhatsApp Cloud API ingress path for Murph hosted users: verify Meta webhook challenges/signatures, parse inbound text messages with sparse payload retention, route opted-in phone/WhatsApp senders into the hosted mailbox, and nudge hosted execution for replies.

## Success criteria

- `@murphai/messaging-ingress` exposes a WhatsApp adapter with signature verification, body parsing, text extraction, and sparse raw minimization tests.
- `apps/web` exposes `/api/whatsapp/webhook` with GET verification and POST delivery handling that fails closed on bad signatures and does not log/store raw provider payloads.
- Hosted routing maps WhatsApp sender ids/phone numbers only through existing hosted member routing state or a narrow documented extension with explicit opt-in/STOP handling.
- Accepted messages append one canonical hosted `conversation.message` mailbox item and use the existing pointer-only nudge workflow.
- Required focused verification and security/privacy review complete, with any live Meta dashboard steps or production token setup called out if they require private user action.

## Scope

- In scope:
  - `packages/messaging-ingress` WhatsApp Cloud API webhook parsing/verification.
  - Hosted web webhook route and minimal routing/consent behavior needed for a safe first bot.
  - Hosted execution, inbox projection, and assistant channel support required for a WhatsApp mailbox wake to decode and deliver replies.
  - Focused tests and durable docs/env notes for the new route.
- Out of scope:
  - Browser-driven Meta Business setup that requires private business/legal details or secrets.
  - Production phone-number registration, message-template approval, and live token storage.
  - Broad assistant-runtime or Cloudflare execution changes unrelated to recognizing WhatsApp as a first-class conversation channel.

## Constraints

- Technical constraints:
  - Preserve existing provider boundary: parsing in `packages/messaging-ingress`, hosted product/routing/mailbox facts in `apps/web`, execution in Cloudflare via existing nudge.
  - Do not store raw WhatsApp webhook bodies, secrets, Authorization headers, or sensitive health/message payloads outside the encrypted hosted mailbox path.
  - Keep ingress idempotent by provider message id.
- Product/process constraints:
  - WhatsApp is a reminders/logging/support channel, not a general AI health chatbot surface.
  - Respect explicit opt-in and STOP/START/HELP command handling before assistant routing.
  - Preserve unrelated dirty worktree edits and existing active plan lanes.

## Risks and mitigations

1. Risk: Expanding a public webhook surface can leak payloads or accept forged messages.
   Mitigation: Verify Meta signatures over raw body, minimize raw payloads, add negative-path tests, and run security/privacy review.
2. Risk: WhatsApp channel state could become a second product truth source.
   Mitigation: Keep route logic on existing hosted routing/mailbox ownership and document any narrow extension.
3. Risk: Live Meta setup requires private values not safe for repo files or logs.
   Mitigation: Implement code and provide exact private setup checklist without recording secrets.

## Tasks

1. Inspect existing hosted Linq/Telegram routing, mailbox append, nudge workflow, and message dedupe patterns.
2. Add WhatsApp parser/signature support and package tests.
3. Add hosted execution/runtime/channel support so WhatsApp wakes import, auto-reply, and dispatch.
4. Add hosted web WhatsApp route/service tests around verify, signature failure, accepted text, STOP/START/HELP, dedupe, mailbox append, and nudge.
5. Update docs/env examples only where needed, using placeholder names and no secrets.
6. Run focused verification, required audits, and close/commit if the scoped commit is safe.

## Decisions

- Use Graph API version from `WHATSAPP_GRAPH_VERSION` with `v25.0` as the default only at the app boundary; parser stays version-agnostic.
- The first hosted route now remains fail-closed for unlinked, inactive, suspended, or non-consented senders. Linked active members can grant WhatsApp messaging consent with `START`, revoke it with `STOP`, and route normal opted-in texts into the hosted mailbox.
- Live Meta app creation is blocked outside the repo by the selected business portfolio restriction: Meta reports the business cannot claim apps while prohibited from advertising.
- WhatsApp now has a typed hosted `conversation.message` wake payload, web-owned append/nudge routing for opted-in active members, and hosted inbox/assistant input normalization.
- Outbound WhatsApp replies are still intentionally blocked on production token storage, template/24-hour-window policy handling, and a WhatsApp effects adapter.

## Verification

- Passed:
  - `pnpm --dir packages/messaging-ingress test:coverage`
  - `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --no-coverage test/hosted-onboarding-whatsapp-route.test.ts test/hosted-onboarding-whatsapp-service.test.ts`
  - `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --no-coverage test/hosted-onboarding-whatsapp-service.test.ts test/hosted-onboarding-whatsapp-route.test.ts test/legal-consent.test.ts`
  - `pnpm --dir packages/hosted-execution test -- --runInBand`
  - `pnpm --dir packages/inboxd exec vitest run --config vitest.config.ts --no-coverage test/hosted-conversation.test.ts`
  - `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-conversation-event.test.ts test/hosted-runtime-mailbox-conversation-import.test.ts`
  - `pnpm --dir apps/web typecheck`
  - `pnpm --dir apps/web lint` with unrelated pre-existing unused-variable warnings.
- Blocked/unrelated:
  - Live Meta webhook challenge and first message proof are blocked on the Meta business portfolio restriction.
  - Current `pnpm typecheck` reaches the WhatsApp/web/package checks but fails in unrelated dirty `apps/cloudflare` browser-vault refresh tests expecting `sourceStateHash` / `expectedSourceStateHash` fields outside this WhatsApp lane.
  - Full `pnpm --dir apps/web test` is red in unrelated active lanes outside this WhatsApp change.
Completed: 2026-05-08
