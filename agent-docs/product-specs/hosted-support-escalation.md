# Hosted support escalation

Last verified: 2026-08-05

Runner policy history: `agent-docs/exec-plans/completed/2026-08-04-support-escalation-consent-prerequisite.md`.
Written-issue correction history: `agent-docs/exec-plans/completed/2026-08-05-support-escalation-written-summary.md`.
Detailed-email plan: `agent-docs/exec-plans/active/2026-08-04-support-escalation-email-summary.md`.

## User purpose

A member who reaches a Murph-owned product failure should stay focused on recovery, not support plumbing. Murph may silently capture a de-identified issue through the existing background feedback path. The support address remains opt-in. An explicit verified-private request for Murph human support authorizes the separate account-linked escalation immediately.

## Conversation contract

- For a clear Murph-owned product failure, call `murph.submit_product_feedback` at most once with `kind: "frustration"` and a concise de-identified product-only summary that does not begin `Support escalation:`.
- Ordinary feedback remains silent and best-effort after the reply. Murph must not imply it was recorded, flagged, or sent. Continue with the best available recovery or fallback.
- Do not mention the tool, feedback ids, queues, email, tickets, or internal escalation mechanics unless the member asks. Give `support@withmurph.ai` only when the member explicitly asks for the address or how to contact support.
- A bug handoff, workaround, or product-team feedback request is ordinary feedback and does not authorize the reserved account-linked shape.
- In a verified private direct conversation, an explicit request for Murph human support authorizes one immediate reserved call with `kind: "frustration"`, no changelog references, and a concise de-identified product-only explanation beginning exactly `Support escalation:`. Murph writes the explanation in its own words; it never copies or quotes the member's message, displays the internal summary, or asks for separate approval first.
- Outside a verified private direct conversation, move human support to private Murph without creating the reserved record. Do not volunteer the address; provide it only when explicitly requested.
- The tool boundary rejects empty, wrong-kind, changelog-linked, and out-of-scope reserved payloads. The hosted runtime records the sanitized written issue through the Web callback inside the turn before Murph may confirm completion; ordinary feedback keeps its best-effort post-delivery flush.
- After accepted or already accepted, say the issue was saved for triage and an account-linked escalation was recorded. On failure, say direct notification failed. Do not add the address unless requested, claim email delivery or receipt, promise a ticket, response, fix, follow-up, or timing, or retry in the same turn.

## Data and privacy

- Ordinary feedback stays de-identified and keeps the existing storage-linkage policy; it does not create the reserved account-linked support marker.
- Explicit support escalation is member-linked because support may need the affected account, but the member-linked row carries only server-authored text and internal ids.
- Murph's written issue is persisted separately without member identity after the shared bounded sanitizer. The paired Web release reads that stored detail back and includes it beside internal escalation metadata for the dedicated support recipient; the runner-policy release alone does not complete the human-support handoff.
- The support email contains a fixed escalation sentence, Murph's stored de-identified product issue, the internal feedback id, and the internal member id. Missing, member-linked, unsanitized, or still-prefixed stored detail fails closed before the provider boundary.
- The fixed member-linked marker stays excluded from the general product-feedback digest. The anonymous issue remains in that existing de-identified triage audience and follows ordinary anonymous-feedback retention, including after account deletion; this preserves one product-feedback history without exposing a member id or creating another lifecycle owner. Account deletion removes the linked marker.
- Never include raw conversation or voice text, names, handles, contact details, health facts or values, diagnoses, medications, precise locations, relationships, secrets, provider payloads, or unrelated context in a feedback summary or support email. The explicit verified-private request authorizes disclosure only of Murph's sanitized de-identified product explanation, never the member's raw wording.

## Deployment contract

- Merge and deploy #1305's hosted runner first, then prove prompt/fingerprint convergence before merging and deploying #1284's Web formatter. The current Web consumer accepts the new prefixed written issue and temporarily sends its existing metadata-only alert, so the member flow does not degrade while the runner converges. #1284 then adds the validated stored issue.
- The new Web formatter intentionally rejects legacy detail that does not match the written-issue contract. Roll back Web before rolling back the runner. The callback envelope, result shape, database schema, and provider key remain unchanged; this ordered rollout needs no API version, feature flag, or compatibility state.

## Rate and replay behavior

- The first three distinct escalation records for one member in one UTC day are email-eligible. Record timestamps are captured after the member-scoped advisory lock is held, so concurrent same-member escalations rank in lock-acquisition order and cannot overshoot the cap.
- Later records remain persisted but do not send another email that day.
- Callback replay validates both deterministic feedback rows, treats the first stored anonymous issue detail as canonical when the same accepted-input identity produces different wording, and may retry an eligible provider request with that stored body and the same Resend idempotency key. Missing, member-linked, or malformed stored detail fails before provider entry, and replay must not create a duplicate recipient-visible email.
- This coordinated runner-and-Web rollout deliberately retains the existing provider key. During Resend's 24-hour key-retention window, a legacy alert that was already accepted before deployment and then replayed after deployment can return `invalid_idempotent_request` because the body changed; the original alert remains delivered and no duplicate is sent. Do not version the key for rollout. Monitor that provider error for 24 hours after deployment; the existing 12-second current-turn callback bound and absence of a retry queue keep the practical overlap narrow.
- Ordinary feedback keeps the existing two-second callback bound; only the exact explicit support shape receives a bounded 12-second callback allowance, spent inside the turn where the model can truthfully report the outcome.
- Murph never retries the model tool in the same turn or attempts to evade the server limit.

## Public source context

The canonical public repository is `https://github.com/cobuildwithus/murph`. Knowing that URL grants no private-repository, production, deployment, support-console, internal-communication, or credential authority.
