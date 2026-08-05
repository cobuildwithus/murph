# Hosted support escalation

Last verified: 2026-08-04

Consent prerequisite plan: `agent-docs/exec-plans/completed/2026-08-04-support-escalation-consent-prerequisite.md`.

## User purpose

A member who reaches a Murph-owned product blocker should not be left at a hard wall. Murph must provide a real support address immediately and, after truthful disclosure and approval in the member's private Murph conversation, can record a de-identified product-only issue and an account-linked escalation. A follow-up release may include that approved issue in the account-linked support notification only after the consent-capable runner has converged in production.

## Conversation contract

- For a Murph product problem, connection failure, or hard product wall, give `support@withmurph.ai` directly. Do not route the member through legal or privacy pages to discover it.
- In a verified private direct conversation, Murph may offer escalation only by showing the exact de-identified product-only summary, stating that it may be included in an internal support escalation linked to the member's Murph account, and asking a natural confirmation question. The offer itself sends nothing. This maximum-disclosure wording remains truthful during the split rollout: the prerequisite records the issue separately from the account-linked escalation, while the follow-up may include the approved issue in the support email.
- A generic request to alert humans, escalate, or open support does not authorize unseen account linkage or an unseen summary. One report for the current issue is authorized only after the member affirmatively approves that exact disclosed summary and potential linkage.
- Reuse `murph.submit_product_feedback` with `kind: "frustration"` and a sanitized product-only summary beginning exactly `Support escalation:`.
- In a group or unverified audience, give the support address but do not create an account-linked escalation from the synthetic room or uncertain audience. Direct the requester to their private Murph conversation for that action. The deterministic unverified-audience safety reply also names the support address so an unverifiable conversation is never a dead end.
- A summary beginning with the reserved `Support escalation:` prefix must carry the exact shape (`frustration` kind, no changelog references, non-empty de-identified content after the prefix); any other prefixed payload is rejected synchronously at the tool boundary so the model can correct it instead of silently degrading.
- The tool boundary also rejects a reserved support payload when the hosted user-action scope is not a verified direct conversation, as defense in depth ahead of the Web synthetic-room check.
- In the hosted runtime, the exact support shape is recorded through the Web callback inside the turn, before the model may confirm anything, so the member-facing confirmation is backed by a durable member-linked record. Ordinary feedback keeps the existing best-effort post-delivery flush.
- After the tool reports the record accepted, say the product issue was saved for triage and an account-linked escalation was recorded, then give the support address. This is the strongest completion claim shared by metadata-only delivery, the later detailed-email delivery, daily email suppression, and exact replay. Do not claim the issue was emailed or seen, that a ticket exists, that Murph will automatically message later, or that a fix has a deadline.
- If the tool is unavailable or the durable record fails, say the direct notification did not complete and give the support address.

## Data and privacy

- Ordinary feedback remains anonymous.
- Ordinary feedback alone follows the silent, best-effort post-reply capture policy. A reserved `Support escalation:` summary is excluded from that policy: it requires the Support section's disclosed approval and waits for the durable callback result before the assistant confirms anything.
- Explicit support escalation is member-linked because support needs to identify the affected private account, but the member-linked row and the support email carry only server-authored text and internal ids — never model-authored free text. The shared redaction pass is best-effort over recognizable shapes, and the repository accepts its residual free-text risk only for anonymous rows, so model-authored summaries must never sit beside member identity in a row, email, or digest.
- The model-authored de-identified issue text (the content after the reserved prefix) is persisted as a separate anonymous feedback row with a deterministic derived id, where it reaches the product team through the ordinary anonymous digest.
- Member-linked support rows are excluded from the daily product-feedback digest; only anonymous rows enter that audience.
- The support email contains exactly: a fixed escalation sentence, the internal feedback id, and the internal member id.
- Never include raw conversation or voice text, names, handles, email addresses, phone numbers, health facts, measurements, diagnoses, medications, precise locations, secrets, provider payloads, or any other unsanitized context in the support summary or email.

## Deployment prerequisite

- This consent-only release changes the hosted runner prompt but leaves Web's support email metadata-only. Land it separately, deploy Cloudflare/runner with `container_rollout=immediate`, and require managed-container smoke to report the exact new bundle fingerprint.
- A follow-up release may place the approved issue beside the member id in email only after that convergence proof. Until then, the existing metadata-only email is the safe compatibility boundary. Do not replace the split landing with a feature flag or model-asserted consent version.

## Rate and replay behavior

- The first three distinct escalation records for one member in one UTC day are email-eligible. Record timestamps are captured after the member-scoped advisory lock is held, so concurrent same-member escalations rank in lock-acquisition order and cannot overshoot the cap.
- Later records remain persisted but do not send another email that day.
- Exact callback replay may retry an eligible provider request with the same Resend idempotency key and must not create a duplicate recipient-visible email.
- Ordinary feedback keeps the existing two-second callback bound; only the exact explicit support shape receives a bounded 12-second callback allowance, spent inside the turn where the model can truthfully report the outcome.
- Murph never retries the model tool in the same turn or attempts to evade the server limit.

## Public source context

The canonical public repository is `https://github.com/cobuildwithus/murph`. Knowing that URL grants no private-repository, production, deployment, support-console, internal-communication, or credential authority.
