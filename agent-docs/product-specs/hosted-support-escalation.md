# Hosted support escalation

Last verified: 2026-08-05

Consent prerequisite plan: `agent-docs/exec-plans/active/2026-08-04-support-escalation-consent-prerequisite.md`.

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

- Ordinary feedback stays de-identified and uses the existing anonymous feedback path.
- Explicit support escalation is member-linked because support may need the affected account, but the member-linked row and prerequisite email carry only server-authored text and internal ids.
- The model-authored issue text after the reserved prefix is persisted separately as anonymous feedback. A follow-up Web release may include that approved text in the account-linked email only after the consent-capable runner has converged in production.
- Member-linked support rows stay excluded from the digest.
- Never include raw conversation or voice text, names, handles, contact details, health facts or values, diagnoses, medications, precise locations, relationships, secrets, provider payloads, or unrelated context in a feedback summary or support email.

## Deployment prerequisite

- Land this consent-only runner release separately, deploy Cloudflare/runner with `container_rollout=immediate`, and require managed-container smoke to report its exact bundle fingerprint.
- Only after that proof may the stacked Web release put the approved issue beside the member id in email. Do not replace the split landing with a feature flag or model-asserted consent version.

## Rate and replay behavior

- The existing three-per-member UTC-day email cap, member advisory lock, provider idempotency key, and replay behavior apply only to explicit reserved support escalation.
- Later explicit support records remain persisted without another email that day. Exact replay may retry one eligible provider request with the same idempotency key without duplicating recipient-visible email.
- Ordinary feedback keeps the existing two-second callback bound and best-effort post-reply flush. The exact reserved support shape keeps its bounded in-turn callback so Murph can report its outcome truthfully.
- Murph never retries the model tool in the same turn or attempts to evade server limits.

## Public source context

The canonical public repository is `https://github.com/cobuildwithus/murph`. Knowing that URL grants no private-repository, production, deployment, support-console, internal-communication, or credential authority.
