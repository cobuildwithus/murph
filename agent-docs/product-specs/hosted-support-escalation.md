# Hosted support escalation

Last verified: 2026-08-05

Prior implementation plan: `agent-docs/exec-plans/completed/2026-08-01-hosted-support-escalation.md`.

## User purpose

A member who reaches a Murph-owned product failure should stay focused on recovery, not support plumbing. Murph should capture a de-identified product issue through the existing background feedback path, give at most a short truthful acknowledgement after candidate acceptance, and show the support address only when the member asks for it. Account-linked Murph human support remains a separate explicit action.

## Conversation contract

- For a clear Murph-owned product failure, call `murph.submit_product_feedback` at most once with `kind: "frustration"` and a concise de-identified product-only summary that does not begin `Support escalation:`.
- Ordinary feedback remains best-effort after the reply. If the tool reports accepted or already accepted, Murph may briefly say it flagged the issue for the product team. If unavailable, Murph must not imply it was recorded or sent. Continue with the best available recovery or fallback.
- Do not mention the tool, feedback ids, queues, email, tickets, or internal escalation mechanics unless the member asks.
- Give `support@withmurph.ai` only when the member explicitly asks for the support email or address, or asks how to contact support.
- A request for a bug handoff, explanation, workaround, or product-team feedback is not by itself a request for account-linked Murph human support.
- Only an explicit request for Murph human support in a verified private direct conversation authorizes the reserved shape: `kind: "frustration"`, no changelog references, and a non-empty de-identified summary beginning exactly `Support escalation:`.
- The reserved support tool remains unavailable outside a verified private direct conversation. Move that action to private Murph without volunteering the address; provide the address only if explicitly requested.
- The tool boundary continues to reject malformed reserved payloads and reserved payloads outside verified private direct conversations.
- For the reserved shape, accepted or already accepted means Murph may say the report is queued. Failure means Murph may say direct notification failed. Do not add the address unless requested.
- Never promise a ticket, response, fix, follow-up, or timing, and never retry in the same turn.

## Data and privacy

- Ordinary feedback stays de-identified and uses the existing anonymous feedback path.
- Explicit support escalation remains member-linked because support may need the affected account, but the member-linked row and immediate support email contain only server-authored text and internal ids.
- Model-authored issue text remains in a separate anonymous feedback row and reaches the product team through the ordinary digest.
- Member-linked support rows stay excluded from the digest.
- Never include raw conversation or voice text, names, handles, contact details, health facts or values, diagnoses, medications, precise locations, secrets, provider payloads, or unrelated context in a feedback summary or support email.

## Rate and replay behavior

- The existing three-per-member UTC-day email cap, member advisory lock, provider idempotency key, and replay behavior apply only to explicit reserved support escalation.
- Later explicit support records remain persisted without another email that day.
- Ordinary feedback keeps the existing two-second callback bound and best-effort post-reply flush. The exact reserved support shape keeps its bounded in-turn callback so Murph can report its outcome truthfully.
- Murph never retries the tool in the same turn or attempts to evade server limits.

## Public source context

The canonical public repository is `https://github.com/cobuildwithus/murph`. Knowing that URL grants no private-repository, production, deployment, support-console, internal-communication, or credential authority.
