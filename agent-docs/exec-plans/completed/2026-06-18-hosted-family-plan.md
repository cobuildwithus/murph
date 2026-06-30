# Hosted Family Plan MVP

Status: completed
Owner: Codex
Started: 2026-06-18

## Goal

Implement the hosted Family plan MVP end to end. One owner pays for a fixed
four-person family plan, including the owner, and can invite up to three family
members. Sponsored family members keep separate private hosted accounts,
routing, mailbox/runtime state, consent, and export/delete rights.

## Scope

- Add a durable product spec for hosted Family plan behavior and privacy
  boundaries.
- Add hosted Postgres state for family groups, memberships, invites, and group
  billing references.
- Add entitlement support for active direct billing or active sponsored family
  membership.
- Add fixed-seat family billing plan support without per-seat billing or
  proration in the MVP.
- Add chat-first family invite issuance and acceptance primitives for Telegram
  deep links and WhatsApp/phone pre-bound invites.
- Add minimal owner management UI only if needed for the MVP control surface.
- Preserve the invariant that family membership pays for access but does not
  share private health data, mailbox content, or vault/runtime state.

## Non-Goals

- No shared family health dashboard.
- No raw health-data visibility for the family owner.
- No child/minor account model.
- No per-seat billing, prorations, or variable quantity billing unless the
  existing Stripe shape makes fixed seats more complex.
- No challenge data sharing beyond future scoped challenge consent.

## Required Reads

- `AGENTS.md`
- `agent-docs/operations/agent-workflow-routing.md`
- `agent-docs/operations/completion-workflow.md`
- `agent-docs/operations/verification-and-runtime.md`
- `agent-docs/SECURITY.md`
- `agent-docs/RELIABILITY.md`
- `agent-docs/FRONTEND.md` if an `apps/web` UI surface is added
- `agent-docs/references/testing-ci-map.md` before final test selection

## Implementation Notes

- Keep family state in `apps/web` Postgres as hosted product/control state.
- Reuse existing hosted onboarding, invite, routing, billing, and activation
  patterns before adding new abstractions.
- Treat Telegram usernames as hints only. The identity proof is a clicked
  Telegram deep link yielding Telegram user/chat identity, or an already-known
  route.
- Treat WhatsApp/phone pre-bound acceptance as valid only when the reply comes
  from the invited phone number.
- Use explicit copy at invite acceptance: the owner pays for access but cannot
  see the member's private messages or health data.

## Verification Plan

- Add focused tests for schema/store behavior, entitlement, invite acceptance,
  billing activation, member removal, and export/delete privacy coverage.
- Run the required `apps/web` verification lane or a truthful diff-aware lane.
- Run required high-risk completion audits: `security-privacy-review`,
  `coverage-write`, `deep-review`, and `frontend-review` if UI is touched.
- Run the local final review, close this plan with `scripts/finish-task`, open a
  PR, and run the required PR deep-review loop.
Updated: 2026-06-19
Completed: 2026-06-19
