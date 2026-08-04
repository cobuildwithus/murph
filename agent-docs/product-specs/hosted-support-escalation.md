# Hosted support escalation

Last verified: 2026-08-04

Implementation plan: `agent-docs/exec-plans/completed/2026-08-04-support-escalation-email-summary.md`.

## User purpose

A member who reaches a Murph-owned product blocker should not be left at a hard wall. Murph must provide a real support address immediately and, after truthful account-linkage disclosure and approval in the member's private Murph conversation, can pass an exact de-identified product-only issue to internal support.

## Conversation contract

- For a Murph product problem, connection failure, or hard product wall, give `support@withmurph.ai` directly. Do not route the member through legal or privacy pages to discover it.
- In a verified private direct conversation, Murph may offer escalation only by showing the exact de-identified product-only summary it intends to send, stating that internal support will receive that summary linked to the member's Murph account, and asking a natural confirmation question. The offer itself sends nothing.
- A generic request to alert humans, escalate, or open support does not authorize unseen account linkage or an unseen summary. One report for the current issue is authorized only after the member affirmatively approves that exact disclosed summary and linkage.
- Reuse `murph.submit_product_feedback` with `kind: "frustration"` and a sanitized product-only summary beginning exactly `Support escalation:`.
- In a group or unverified audience, give the support address but do not create an account-linked escalation from the synthetic room or uncertain audience. Direct the requester to their private Murph conversation for that action. The deterministic unverified-audience safety reply also names the support address so an unverifiable conversation is never a dead end.
- A summary beginning with the reserved `Support escalation:` prefix must carry the exact shape (`frustration` kind, no changelog references, non-empty de-identified content after the prefix); any other prefixed payload is rejected synchronously at the tool boundary so the model can correct it instead of silently degrading.
- The tool boundary also rejects a reserved support payload when the hosted user-action scope is not a verified direct conversation, as defense in depth ahead of the Web synthetic-room check.
- In the hosted runtime, the exact support shape is recorded through the Web callback inside the turn, before the model may confirm anything, so the member-facing confirmation is backed by a durable member-linked record. Ordinary feedback keeps the existing best-effort post-delivery flush.
- After the tool reports the record accepted, say the account-linked product summary was recorded and give the support address. Do not claim that an immediate alert was sent, because the existing daily cap may retain a later record without another email. Do not claim that a human has read it, that a ticket exists, that Murph will automatically message later, or that a fix has a deadline.
- If the tool is unavailable or the durable record fails, say the direct notification did not complete and give the support address.

## Data and privacy

- Ordinary feedback remains anonymous.
- Explicit support escalation is member-linked because support needs to identify the affected private account. The member-linked row remains fixed server-authored metadata; model-authored free text never becomes durable beside member identity.
- The model-authored de-identified issue text (the content after the reserved prefix) is persisted as a separate anonymous feedback row with a deterministic derived id. That row remains the only durable free-text owner and supplies both the ordinary anonymous digest and the immediate support alert.
- The immediate support alert explicitly pairs that bounded de-identified product-only summary with internal feedback and member ids only after the verified private member sees and affirmatively approves the exact summary and account linkage. The model-facing product-only contract is the primary privacy boundary, and the shared deterministic scrub remains defense in depth over recognizable contact, identifier, secret, network, and exact-health-value shapes.
- Member-linked support rows are excluded from the daily product-feedback digest; only anonymous rows enter that audience.
- The support email contains exactly: a fixed escalation sentence, the labeled de-identified issue summary without the reserved prefix, the internal feedback id, and the internal member id.
- Never include raw conversation or voice text, names, handles, email addresses, phone numbers, health facts, measurements, diagnoses, medications, precise locations, secrets, provider payloads, or any other unsanitized context in the support summary or email.

## Rate and replay behavior

- The first three distinct escalation records for one member in one UTC day are email-eligible. Record timestamps are captured after the member-scoped advisory lock is held, so concurrent same-member escalations rank in lock-acquisition order and cannot overshoot the cap.
- Later records remain persisted but do not send another email that day.
- Callback replay validates both deterministic feedback rows, treats the first stored anonymous issue detail as canonical when the same accepted-input identity produces different wording, and may retry an eligible provider request with that stored body and the same Resend idempotency key. Missing, member-linked, or malformed stored detail fails before provider entry, and replay must not create a duplicate recipient-visible email.
- This payload-only Web rollout deliberately retains the existing provider key. During Resend's 24-hour key-retention window, a legacy alert that was already accepted before deployment and then replayed after deployment can return `invalid_idempotent_request` because the body changed; the original alert remains delivered and no duplicate is sent. Do not version the key for rollout. Monitor that provider error for 24 hours after deployment; the existing 12-second current-turn callback bound and absence of a retry queue keep the practical overlap narrow.
- Ordinary feedback keeps the existing two-second callback bound; only the exact explicit support shape receives a bounded 12-second callback allowance, spent inside the turn where the model can truthfully report the outcome.
- Murph never retries the model tool in the same turn or attempts to evade the server limit.

## Public source context

The canonical public repository is `https://github.com/cobuildwithus/murph`. Knowing that URL grants no private-repository, production, deployment, support-console, internal-communication, or credential authority.
