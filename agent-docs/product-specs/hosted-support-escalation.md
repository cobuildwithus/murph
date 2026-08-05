# Hosted support escalation

Last verified: 2026-08-05

Runner policy plan: `agent-docs/exec-plans/active/2026-08-04-support-escalation-consent-prerequisite.md`.

## User purpose

A member who reaches a Murph-owned product failure should stay focused on recovery, not support plumbing. Murph may silently capture a de-identified issue through the existing background feedback path. The support address remains opt-in. An explicit verified-private request for Murph human support authorizes the separate account-linked escalation immediately.

## Conversation contract

- For a clear Murph-owned product failure, call `murph.submit_product_feedback` at most once with `kind: "frustration"` and a concise de-identified product-only summary that does not begin `Support escalation:`.
- Ordinary feedback remains silent and best-effort after the reply. Murph must not imply it was recorded, flagged, or sent. Continue with the best available recovery or fallback.
- Do not mention the tool, feedback ids, queues, email, tickets, or internal escalation mechanics unless the member asks. Give `support@withmurph.ai` only when the member explicitly asks for the address or how to contact support.
- A bug handoff, workaround, or product-team feedback request is ordinary feedback and does not authorize the reserved account-linked shape.
- In a verified private direct conversation, an explicit request for Murph human support authorizes one immediate reserved call with `kind: "frustration"`, the literal summary `Support escalation`, no changelog references, and the closest allowlisted `supportArea` and `supportProblem`. The tool builds the canonical issue text; Murph does not display it or ask for separate approval first.
- Outside a verified private direct conversation, move human support to private Murph without creating the reserved record. Do not volunteer the address; provide it only when explicitly requested.
- The tool boundary rejects free-form or malformed reserved payloads and reserved payloads outside verified private direct conversations. The hosted runtime records the exact closed-vocabulary issue shape through the Web callback inside the turn before Murph may confirm completion; ordinary feedback keeps its best-effort post-delivery flush.
- After accepted or already accepted, say the issue was saved for triage and an account-linked escalation was recorded. On failure, say direct notification failed. Do not add the address unless requested, claim email delivery or receipt, promise a ticket, response, fix, follow-up, or timing, or retry in the same turn.

## Data and privacy

- Ordinary feedback stays de-identified and keeps the existing storage-linkage policy; it does not create the reserved account-linked support marker.
- Explicit support escalation is member-linked because support may need the affected account, but the member-linked row carries only server-authored text and internal ids.
- The model selects only allowlisted product-area and failure codes. The tool turns them into a canonical issue string, which is persisted separately without member identity. The paired Web release renders only those server-validated codes into the account-linked email; the runner-policy release alone does not complete the human-support handoff.
- Member-linked support rows stay excluded from the digest.
- Never include raw conversation or voice text, names, handles, contact details, health facts or values, diagnoses, medications, precise locations, relationships, secrets, provider payloads, or unrelated context in a feedback summary or support email. Free-form model text is not email-disclosure authority.

## Rate and replay behavior

- The existing three-per-member UTC-day email cap, member advisory lock, provider idempotency key, and replay behavior apply only to explicit reserved support escalation.
- Later explicit support records remain persisted without another email that day. Exact replay may retry one eligible provider request with the same idempotency key without duplicating recipient-visible email.
- Ordinary feedback keeps the existing two-second callback bound and best-effort post-reply flush. The exact reserved support shape keeps its bounded in-turn callback so Murph can report its outcome truthfully.
- Murph never retries the model tool in the same turn or attempts to evade server limits.

## Public source context

The canonical public repository is `https://github.com/cobuildwithus/murph`. Knowing that URL grants no private-repository, production, deployment, support-console, internal-communication, or credential authority.
