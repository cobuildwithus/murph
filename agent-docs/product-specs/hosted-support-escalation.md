# Hosted support escalation

Last verified: 2026-08-05

Runner policy plan: `agent-docs/exec-plans/active/2026-08-04-support-escalation-consent-prerequisite.md`.
Detailed-email plan: `agent-docs/exec-plans/active/2026-08-04-support-escalation-email-summary.md`.

## User purpose

A member who reaches a Murph-owned product failure should stay focused on recovery, not support plumbing. Murph may capture a de-identified issue through the existing background feedback path and give one short truthful acknowledgement after candidate acceptance. The support address remains opt-in. An explicit verified-private request for Murph human support authorizes the separate account-linked escalation immediately.

## Conversation contract

- For a clear Murph-owned product failure, call `murph.submit_product_feedback` at most once with `kind: "frustration"` and a concise de-identified product-only summary that does not begin `Support escalation:`.
- Ordinary feedback remains best-effort after the reply. If the candidate is accepted or already accepted, Murph may briefly say it flagged the issue for the product team. If unavailable, Murph must not imply it was recorded or sent. Continue with the best available recovery or fallback.
- Do not mention the tool, feedback ids, queues, email, tickets, or internal escalation mechanics unless the member asks. Give `support@withmurph.ai` only when the member explicitly asks for the address or how to contact support.
- A bug handoff, workaround, or product-team feedback request is ordinary feedback and does not authorize the reserved account-linked shape.
- In a verified private direct conversation, an explicit request for Murph human support authorizes one immediate reserved call with `kind: "frustration"`, no changelog references, and a concise de-identified product-only summary beginning exactly `Support escalation:`. Murph does not display that summary or ask for separate approval first.
- Outside a verified private direct conversation, move human support to private Murph without creating the reserved record. Do not volunteer the address; provide it only when explicitly requested.
- The tool boundary rejects malformed reserved payloads and reserved payloads outside verified private direct conversations. The hosted runtime records the exact reserved shape through the Web callback inside the turn before Murph may confirm completion; ordinary feedback keeps its best-effort post-delivery flush.
- After accepted or already accepted, say the issue was saved for triage and an account-linked escalation was recorded. On failure, say direct notification failed. Do not add the address unless requested, claim email delivery or receipt, promise a ticket, response, fix, follow-up, or timing, or retry in the same turn.

## Data and privacy

- Ordinary feedback stays de-identified and uses the existing anonymous feedback path.
- Reserved support escalation waits for the durable callback result before Murph confirms anything. It is member-linked because support may need the affected account, but the member-linked row remains fixed server-authored metadata; model-authored free text never becomes durable beside member identity.
- The model-authored de-identified issue text after the reserved prefix is persisted as a separate anonymous feedback row with a deterministic derived id. That row remains the only durable free-text owner and supplies both the anonymous digest and the immediate support alert.
- For an email-eligible escalation, the alert pairs that stored bounded product-only summary with internal feedback and member ids. The model-facing product-only contract is the primary privacy boundary, and the shared deterministic scrub remains defense in depth over recognizable contact, identifier, secret, network, and exact-health-value shapes.
- Member-linked support rows stay excluded from the daily product-feedback digest; only anonymous rows enter that audience.
- The support email contains exactly a fixed escalation sentence, the labeled de-identified issue without the reserved prefix, the internal feedback id, and the internal member id.
- Never include raw conversation or voice text, names, handles, email addresses, phone numbers, health facts or values, diagnoses, medications, precise locations, relationships, secrets, provider payloads, or any other unsanitized context in the support summary or email.

## Deployment contract

- Runner policy and detailed-email Web behavior retain the same callback payload, validation, persisted rows, and result shape, so they are compatible in either deployment order and add no version or rollout floor.
- Runner-first temporarily preserves the metadata-only email; Web-first enriches any already-valid reserved escalation. Ordinary deployment smoke remains required, but immediate runner convergence is not a privacy prerequisite for the email change.

## Rate and replay behavior

- The first three distinct escalation records for one member in one UTC day are email-eligible. Record timestamps are captured after the member-scoped advisory lock is held, so concurrent same-member escalations rank in lock-acquisition order and cannot overshoot the cap.
- Later records remain persisted but do not send another email that day.
- Callback replay validates both deterministic feedback rows, treats the first stored anonymous issue detail as canonical when the same accepted-input identity produces different wording, and may retry an eligible provider request with that stored body and the same Resend idempotency key. Missing, member-linked, or malformed stored detail fails before provider entry, and replay must not create a duplicate recipient-visible email.
- This coordinated runner-and-Web rollout deliberately retains the existing provider key. During Resend's 24-hour key-retention window, a legacy alert that was already accepted before deployment and then replayed after deployment can return `invalid_idempotent_request` because the body changed; the original alert remains delivered and no duplicate is sent. Do not version the key for rollout. Monitor that provider error for 24 hours after deployment; the existing 12-second current-turn callback bound and absence of a retry queue keep the practical overlap narrow.
- Ordinary feedback keeps the existing two-second callback bound; only the exact explicit support shape receives a bounded 12-second callback allowance, spent inside the turn where the model can truthfully report the outcome.
- Murph never retries the model tool in the same turn or attempts to evade the server limit.

## Public source context

The canonical public repository is `https://github.com/cobuildwithus/murph`. Knowing that URL grants no private-repository, production, deployment, support-console, internal-communication, or credential authority.
