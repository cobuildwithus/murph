# Generalized product feedback

Status: completed
Created: 2026-06-23
Updated: 2026-06-23

## Goal

- Broaden hosted product feedback from changelog-only feature-interest capture into a small structured feedback intake surface for explicit user frustration, feature requests, and shipped-item interest, while preserving privacy and authority boundaries.

## Success Criteria

- `murph.submit_product_feedback` can record allowlisted feedback kinds beyond shipped changelog interest.
- Payload remains structured and minimal: no raw conversation text, health details, identifiers, contact details, secrets, provider payloads, tags, or arbitrary summaries.
- Shipped changelog item references are still accepted and server-validated when present, but no longer required for every feedback kind.
- Weekly product update automation closes with an invitation to mention interesting updates or other feature ideas.
- Hosted web remains the persistence owner; Cloudflare remains a signed callback path only.
- Focused tests and required verification/audits pass or have documented unrelated blockers.

## Scope

- In scope:
  - Product feedback contracts in `packages/hosted-execution`.
  - Assistant dynamic tool schema/description and managed automation prompt text in `packages/assistant-engine`.
  - Web persistence validation/export docs for `HostedProductFeedback`.
  - Focused tests for product feedback parsing, persistence, and assistant tool behavior.
  - Durable docs that currently describe changelog-only feedback.
- Out of scope:
  - Free-form feedback text storage.
  - Product feedback analytics, admin dashboards, notification flows, or triage queues.
  - UI changes beyond existing changelog prompt copy.

## Constraints

- Follow the GPT-5.5 prompt guidance direction: outcome-first, concise tool rules, and explicit side-effect limits.
- Keep hosted product-feedback rows as operational/idempotency state, not canonical health truth.
- Do not persist raw user utterances, conversation excerpts, inferred health content, direct identifiers, contact details, secrets, provider payloads, unrelated context, or model-generated tags.
- Do not use the tool silently; the user must explicitly express product frustration, request a feature, or state interest in shipped changelog items.

## Verification

- Focused package/app tests covering product feedback contracts, assistant dynamic tool behavior, and web persistence.
- `pnpm typecheck` and/or truthful `pnpm test:diff` for touched owners.
- Required completion audits: security/privacy, coverage-write, deep-review due persisted-state and cross-owner hosted runtime boundary changes.

## State

- Done: widened the hosted feedback contract, assistant dynamic tool schema, managed automation copy, web persistence/export path, Prisma schema/migration, focused tests, durable docs, required audits, and scoped verification.
- Done: removed model-controlled `feedbackTags` after audit; persisted feedback remains limited to kind/topic plus optional validated changelog ids.
- Now: closing the active plan with a scoped commit.
- Next: hand off deployment order and verification notes.
Completed: 2026-06-23
