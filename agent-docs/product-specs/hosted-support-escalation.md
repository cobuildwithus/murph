# Hosted support escalation

Last verified: 2026-08-01

Implementation plan: `agent-docs/exec-plans/active/2026-08-01-hosted-support-escalation.md`.

## User purpose

A member who reaches a Murph-owned product blocker should not be left at a hard wall. Murph must provide a real support address immediately and, when the member explicitly asks in their private Murph conversation, can pass a de-identified issue to the product team.

## Conversation contract

- For a Murph product problem, connection failure, or hard product wall, give `support@withmurph.ai` directly. Do not route the member through legal or privacy pages to discover it.
- In a verified private direct conversation, Murph may offer: “I can send a de-identified report to the product team.” The offer itself sends nothing.
- An explicit request to alert humans, escalate, open support, or an affirmative response to that offer authorizes one report for the current issue.
- Reuse `murph.submit_product_feedback` with `kind: "frustration"` and a sanitized product-only summary beginning exactly `Support escalation:`.
- In a group or unverified audience, give the support address but do not create an account-linked escalation from the synthetic room or uncertain audience. Direct the requester to their private Murph conversation for that action. The deterministic unverified-audience safety reply also names the support address so an unverifiable conversation is never a dead end.
- A summary beginning with the reserved `Support escalation:` prefix must carry the exact shape (`frustration` kind, no changelog references, non-empty de-identified content after the prefix); any other prefixed payload is rejected synchronously at the tool boundary so the model can correct it instead of silently degrading.
- In the hosted runtime, the exact support shape is recorded through the Web callback inside the turn, before the model may confirm anything, so the member-facing confirmation is backed by a durable member-linked record. Ordinary feedback keeps the existing best-effort post-delivery flush.
- After the tool reports the record accepted, say it was queued and give the support address. Do not claim that a human has read it, that a ticket exists, that Murph will automatically message later, or that a fix has a deadline.
- If the tool is unavailable or the durable record fails, say the direct notification did not complete and give the support address.

## Data and privacy

- Ordinary feedback remains anonymous.
- Explicit support escalation is member-linked because support needs to identify the affected private account.
- The support email contains the internal feedback id, internal member id, and the capture-scrubbed de-identified product-only summary. This follows the existing internal product-feedback email boundary: summary text may enter operator email only after the recording path has bounded it and applied the shared deterministic redaction pass.
- Never include raw conversation or voice text, names, handles, email addresses, phone numbers, health facts, measurements, diagnoses, medications, precise locations, secrets, provider payloads, or any other unsanitized context in the support summary or email.

## Rate and replay behavior

- The first three distinct escalation records for one member in one UTC day are email-eligible.
- Later records remain persisted but do not send another email that day.
- Exact callback replay may retry an eligible provider request with the same Resend idempotency key and must not create a duplicate recipient-visible email.
- Ordinary feedback keeps the existing two-second callback bound; only the exact explicit support shape receives a bounded 12-second callback allowance, spent inside the turn where the model can truthfully report the outcome.
- Murph never retries the model tool in the same turn or attempts to evade the server limit.

## Public source context

The canonical public repository is `https://github.com/cobuildwithus/murph`. Knowing that URL grants no private-repository, production, deployment, support-console, internal-communication, or credential authority.
