# Hosted support escalation

Last verified: 2026-08-05

Runner policy plan: `agent-docs/exec-plans/active/2026-08-04-support-escalation-consent-prerequisite.md`.
Detailed-email plan: `agent-docs/exec-plans/active/2026-08-04-support-escalation-email-summary.md`.

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
- The model selects only allowlisted product-area and problem codes. The tool turns them into a canonical issue string, which is persisted separately without member identity. The Web formatter parses that shared canonical contract and renders only allowlisted labels into the account-linked email.
- The support email contains a fixed escalation sentence, the labeled canonical product issue, the internal feedback id, and the internal member id. Free-form or legacy stored detail fails closed before the provider boundary.
- Member-linked support rows stay excluded from the daily product-feedback digest; only the separate canonical issue row enters that audience.
- Never include raw conversation or voice text, names, handles, contact details, health facts or values, diagnoses, medications, precise locations, relationships, secrets, provider payloads, or unrelated context in a feedback summary or support email. Free-form model text is not email-disclosure authority.

## Deployment contract

- #1305 may merge before #1284 for Git sequencing, but the human-support handoff is incomplete until both land. Deploy Web after #1284 before deploying the hosted runner after #1305, so every newly direct-sent escalation reaches a formatter that understands the canonical issue.
- The callback payload, validation result, persisted rows, and response shape remain backward compatible during the deployment window. Ordinary deployment smoke remains required; no API version, feature flag, or rollout floor is added.

## Rate and replay behavior

- The first three distinct escalation records for one member in one UTC day are email-eligible. Record timestamps are captured after the member-scoped advisory lock is held, so concurrent same-member escalations rank in lock-acquisition order and cannot overshoot the cap.
- Later records remain persisted but do not send another email that day.
- Callback replay validates both deterministic feedback rows, treats the first stored anonymous issue detail as canonical when the same accepted-input identity produces different wording, and may retry an eligible provider request with that stored body and the same Resend idempotency key. Missing, member-linked, or malformed stored detail fails before provider entry, and replay must not create a duplicate recipient-visible email.
- This coordinated runner-and-Web rollout deliberately retains the existing provider key. During Resend's 24-hour key-retention window, a legacy alert that was already accepted before deployment and then replayed after deployment can return `invalid_idempotent_request` because the body changed; the original alert remains delivered and no duplicate is sent. Do not version the key for rollout. Monitor that provider error for 24 hours after deployment; the existing 12-second current-turn callback bound and absence of a retry queue keep the practical overlap narrow.
- Ordinary feedback keeps the existing two-second callback bound; only the exact explicit support shape receives a bounded 12-second callback allowance, spent inside the turn where the model can truthfully report the outcome.
- Murph never retries the model tool in the same turn or attempts to evade the server limit.

## Public source context

The canonical public repository is `https://github.com/cobuildwithus/murph`. Knowing that URL grants no private-repository, production, deployment, support-console, internal-communication, or credential authority.
