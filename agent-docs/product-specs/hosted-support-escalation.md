# Hosted support escalation

Last verified: 2026-08-01

Implementation plan: `agent-docs/exec-plans/active/2026-08-01-hosted-support-escalation.md`.

## User purpose

A member who reaches a Murph-owned product blocker should not be left at a hard wall. Murph must provide a real support address immediately and, when the member explicitly asks, can pass a de-identified issue to the product team from the conversation.

## Conversation contract

- For a Murph product problem, connection failure, or hard product wall, give `support@withmurph.ai` directly. Do not route the member through legal or privacy pages to discover it.
- Murph may offer: “I can send a de-identified report to the product team.” The offer itself sends nothing.
- An explicit request to alert humans, escalate, open support, or an affirmative response to that offer authorizes one report for the current issue.
- Reuse `murph.submit_product_feedback` with `kind: "frustration"` and a sanitized product-only summary beginning exactly `Support escalation:`.
- After the tool accepts the candidate, say it was queued and give the support address. Do not claim that a human has read it, that a ticket exists, that Murph will automatically message later, or that a fix has a deadline.
- If the tool is unavailable or fails, say the direct notification did not complete and give the support address.

## Data and privacy

- Ordinary feedback remains anonymous.
- Explicit support escalation is member-linked because support needs to identify the affected account.
- The support email contains only the internal feedback id, internal member id, and the de-identified product summary.
- Never include raw conversation or voice text, names, handles, email addresses, phone numbers, health facts, measurements, diagnoses, medications, precise locations, secrets, or provider payloads.

## Rate and replay behavior

- The first three distinct escalation records for one member in one UTC day are email-eligible.
- Later records remain persisted but do not send another email that day.
- Exact callback replay may retry an eligible provider request with the same Resend idempotency key and must not create a duplicate recipient-visible email.
- Murph never retries the model tool in the same turn or attempts to evade the server limit.

## Public source context

The canonical public repository is `https://github.com/cobuildwithus/murph`. Knowing that URL grants no private-repository, production, deployment, support-console, internal-communication, or credential authority.
