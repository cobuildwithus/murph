# Hosted support escalation

Status: active
Created: 2026-08-01
Updated: 2026-08-01

## Goal

Give a member who hits a real Murph product wall two truthful exits in the same conversation:

1. the public support address, `support@withmurph.ai`; and
2. in their verified private direct conversation, an explicit consented path that queues a de-identified issue for the product team and sends a bounded internal support alert.

## Success criteria

- Murph gives the public support address directly instead of searching legal pages or claiming there is no support route.
- An explicit private-member request to alert humans reuses `murph.submit_product_feedback` rather than adding a second feedback transport.
- Group and unverified audiences receive the address but cannot bind an account-linked escalation to a synthetic room or uncertain audience.
- The escalation summary is de-identified, product-only, and begins with one exact server-recognized prefix.
- Ordinary product feedback remains anonymous by default.
- Explicit support escalation is linked to the authenticated private member so support can investigate the correct account.
- At most three distinct escalation records per member per UTC day are eligible to send email.
- Duplicate callback attempts reuse one stable Resend idempotency key.
- The support email carries only the feedback id, member id, and capture-scrubbed de-identified product summary allowed by the existing internal feedback-email boundary.
- The public GitHub repository URL is present in the assistant instruction stack without implying private or production access.

## Existing owners reused

- Assistant tool and turn-scoped idempotency: `murph.submit_product_feedback`.
- Signed member-bound callback: the existing hosted product-feedback record route.
- Persistence: `HostedProductFeedback` in Web Postgres.
- Email transport: the existing bounded plain-text Resend helper and operational email configuration.

## Design

- The assistant offers account-linked escalation only for a product problem in a verified private direct conversation and calls the existing feedback tool only after the member explicitly asks or accepts the offer.
- In a group or unverified audience, the assistant gives the public support address and moves account-linked escalation to the requester's private Murph.
- A summary beginning exactly `Support escalation:` marks the explicit support path.
- The Web route attaches the callback-authenticated member only for that exact path; every other feedback record keeps the existing anonymous behavior.
- Web serializes support records with a member-scoped PostgreSQL advisory transaction lock, ranks the record within its UTC day, and emails only ranks one through three.
- A duplicate eligible record may retry the email, but its stable provider idempotency key prevents another recipient-visible email.
- The email contains the feedback id, internal member id, and the same bounded capture-scrubbed de-identified summary stored in the feedback row. Raw transcript, contact details, provider payloads, health data, and unsanitized context never cross the email boundary.
- Ordinary feedback keeps its two-second callback cap. Only the exact support-prefixed path receives a bounded 12-second cap so the existing Resend request can finish off the reply path.

## Failure behavior

- Missing member authority fails closed.
- Missing Resend configuration or provider failure returns an error after the support record exists; an exact retry can attempt the same provider idempotency key again.
- Later-than-third daily records remain persisted but do not email.
- Murph says the report was queued, never that a human received it, opened a ticket, will respond, or will fix it on a particular timeline.

## Verification

- Focused assistant prompt tests, including the existing base-instruction size contract and group/private route language.
- Focused assistant same-turn escalation-priority tests.
- Focused hosted Web route and support-email service tests.
- Focused Cloudflare callback-deadline tests.
- Web and assistant-engine typecheck/CI on the exact PR head.
- Parent diff review for audience ownership, anonymity, member binding, email disclosure, rate-limit concurrency, and provider idempotency.

## State

- Draft PR #1247 is open from `agent/support-escalation-email`.
- Initial exact-head failures in prompt invariants and doc indexing were corrected.
- Current implementation is aligned with the feedback-summary email policy merged to `main` on August 1.
- Next: finish exact-head CI and review, then close this plan if the branch is merge-ready.
