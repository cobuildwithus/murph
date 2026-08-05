# Hosted support escalation

Last verified: 2026-08-05

Consent prerequisite plan: `agent-docs/exec-plans/active/2026-08-04-support-escalation-consent-prerequisite.md`.
Detailed-email plan: `agent-docs/exec-plans/active/2026-08-04-support-escalation-email-summary.md`.

## User purpose

A member who reaches a Murph-owned product failure should stay focused on recovery, not support plumbing. Murph may capture a de-identified issue through the existing background feedback path and give one short truthful acknowledgement after candidate acceptance. The support address remains opt-in. Account-linked human support is a separate explicit action that requires exact-summary and potential-linkage consent before the reserved support record is created.

## Conversation contract

- For a clear Murph-owned product failure, call `murph.submit_product_feedback` at most once with `kind: "frustration"` and a concise de-identified product-only summary that does not begin `Support escalation:`.
- Ordinary feedback remains best-effort after the reply. If the candidate is accepted or already accepted, Murph may briefly say it flagged the issue for the product team. If unavailable, Murph must not imply it was recorded or sent. Continue with the best available recovery or fallback.
- Do not mention the tool, feedback ids, queues, email, tickets, or internal escalation mechanics unless the member asks. Give `support@withmurph.ai` only when the member explicitly asks for the address or how to contact support.
- A bug handoff, workaround, product-team feedback request, or even a first request for Murph human support does not authorize an unseen account-linked summary.
- In a verified private direct conversation, respond to an explicit human-support request by showing the exact de-identified product-only summary, saying it may enter an internal escalation linked to the member's Murph account, and asking a natural confirmation question. The offer sends nothing.
- Only affirmative approval of that shown summary and potential linkage authorizes one reserved call with `kind: "frustration"`, no changelog references, and the approved summary beginning exactly `Support escalation:`.
- Outside a verified private direct conversation, move human support to private Murph without creating the reserved record. Do not volunteer the address; provide it only when explicitly requested.
- The tool boundary rejects malformed reserved payloads and reserved payloads outside verified private direct conversations. The hosted runtime records the exact reserved shape through the Web callback inside the turn before Murph may confirm completion; ordinary feedback keeps its best-effort post-delivery flush.
- After accepted or already accepted, say the issue was saved for triage and an account-linked escalation was recorded. On failure, say direct notification failed. Do not add the address unless requested, claim email delivery or receipt, promise a ticket, response, fix, follow-up, or timing, or retry in the same turn.

## Data and privacy

- Ordinary feedback remains anonymous.
- Ordinary feedback alone follows the silent, best-effort post-reply capture policy. A reserved `Support escalation:` summary is excluded from that policy: it requires the Support section's disclosed approval and waits for the durable callback result before the assistant confirms anything.
- Explicit support escalation is member-linked because support needs to identify the affected private account. The member-linked row remains fixed server-authored metadata; model-authored free text never becomes durable beside member identity.
- The model-authored de-identified issue text (the content after the reserved prefix) is persisted as a separate anonymous feedback row with a deterministic derived id. That row remains the only durable free-text owner and supplies both the ordinary anonymous digest and the immediate support alert.
- The immediate support alert explicitly pairs that bounded de-identified product-only summary with internal feedback and member ids only after the verified private member sees the exact summary and affirmatively approves its potential inclusion in the account-linked escalation. The model-facing product-only contract is the primary privacy boundary, and the shared deterministic scrub remains defense in depth over recognizable contact, identifier, secret, network, and exact-health-value shapes.
- Member-linked support rows are excluded from the daily product-feedback digest; only anonymous rows enter that audience.
- The support email contains exactly: a fixed escalation sentence, the labeled de-identified issue summary without the reserved prefix, the internal feedback id, and the internal member id.
- Never include raw conversation or voice text, names, handles, email addresses, phone numbers, health facts, measurements, diagnoses, medications, precise locations, secrets, provider payloads, or any other unsanitized context in the support summary or email.

## Deployment contract

- The consent-only prerequisite changes the hosted runner prompt but leaves Web's support email metadata-only. Land it separately, deploy Cloudflare/runner with `container_rollout=immediate`, and require managed-container smoke to report the exact new bundle fingerprint before the stacked detailed-email PR may merge.
- New runner plus old Web is safe: the member sees and approves the exact account-linked summary while the old alert remains metadata-only. Old runner plus new Web is unsafe and must not be admitted. New runner plus new Web completes the intended flow.
- The consent-capable runner is the rollback floor while detailed-email Web is deployed. Roll back Web first; only after Web no longer emits detailed alerts may Cloudflare/runner return to the earlier policy. Use the existing bundle/source fingerprint admission and deploy smoke rather than adding consent-version state to the callback or database.

## Rate and replay behavior

- The first three distinct escalation records for one member in one UTC day are email-eligible. Record timestamps are captured after the member-scoped advisory lock is held, so concurrent same-member escalations rank in lock-acquisition order and cannot overshoot the cap.
- Later records remain persisted but do not send another email that day.
- Callback replay validates both deterministic feedback rows, treats the first stored anonymous issue detail as canonical when the same accepted-input identity produces different wording, and may retry an eligible provider request with that stored body and the same Resend idempotency key. Missing, member-linked, or malformed stored detail fails before provider entry, and replay must not create a duplicate recipient-visible email.
- This coordinated runner-and-Web rollout deliberately retains the existing provider key. During Resend's 24-hour key-retention window, a legacy alert that was already accepted before deployment and then replayed after deployment can return `invalid_idempotent_request` because the body changed; the original alert remains delivered and no duplicate is sent. Do not version the key for rollout. Monitor that provider error for 24 hours after deployment; the existing 12-second current-turn callback bound and absence of a retry queue keep the practical overlap narrow.
- Ordinary feedback keeps the existing two-second callback bound; only the exact explicit support shape receives a bounded 12-second callback allowance, spent inside the turn where the model can truthfully report the outcome.
- Murph never retries the model tool in the same turn or attempts to evade the server limit.

## Public source context

The canonical public repository is `https://github.com/cobuildwithus/murph`. Knowing that URL grants no private-repository, production, deployment, support-console, internal-communication, or credential authority.
