# WhatsApp outbound delivery

## Goal

Make hosted WhatsApp messages bidirectional enough for the Murph assistant runtime to send Cloud API text replies to an opted-in WhatsApp conversation.

## Scope

- Add a narrow WhatsApp Cloud API outbound runtime helper.
- Register `whatsapp` as an assistant delivery channel.
- Route hosted runner provider effects through the existing active-lease effects-port boundary.
- Keep ingress-only verification secrets out of user-controlled runner env.

## Out of Scope

- Production template authoring and message-template approval.
- General WhatsApp account/business verification setup.
- Rich media, buttons, reactions, or non-text WhatsApp messages.

## Constraints

- Do not log or fixture access tokens, app secrets, full Authorization headers, or raw message bodies.
- Use the existing assistant outbox, delivery journal, and provider-effect boundaries.
- Preserve unrelated active worktree edits and active hosted-runtime plans.

## Verification Plan

- Focused tests for the WhatsApp runtime helper.
- Focused assistant-channel/outbound tests for `whatsapp`.
- Focused hosted provider-effect contract tests for WhatsApp.
- Typecheck or the narrowest truthful scoped check, with any unrelated blockers named explicitly.

## Status

Implementation and focused verification complete. Live Meta/Vercel/Cloudflare configuration remains.

## Done

- Added a WhatsApp Cloud API outbound text helper in operator-config.
- Registered `whatsapp` as an assistant channel and direct-chat auto-reply candidate.
- Routed hosted runtime WhatsApp sends through the Cloudflare active-lease provider-effect path.
- Added Worker deploy env plumbing for WhatsApp Cloud API credentials.
- Hardened sparse webhook metadata redaction for placeholder-prefixed local paths.
- Focused provider/channel/helper tests and package typechecks passed.
- WhatsApp route/service, hosted runtime conversation, and messaging-ingress parser tests passed.

## Next

- Add Vercel webhook ingress envs and Cloudflare Worker WhatsApp outbound envs.
- Configure Meta webhook callback/subscription and send a test WhatsApp message.
- Verify the inbound wake reaches the hosted mailbox and produces a WhatsApp reply.
