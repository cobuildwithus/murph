# Reject departed joined-group routes

Status: completed
Created: 2026-08-28
Updated: 2026-08-28

## Goal

- Prevent joined-group inventory and handoff from treating a provider chat as
  usable after Murph's sending participant has left or been removed, without
  adding matching machinery, persisted state, or a second authority model.

## Success criteria

- `list_memberships` reports each membership's action availability separately
  from participant-roster availability.
- A chat whose current provider summary shows no active Murph sender is not
  offered as a handoff destination.
- `group_consult({ action: "handoff", membershipId, context })` repeats the same
  live provider usability check before enqueueing, outside its database
  transaction, and enqueues nothing when the chat is unavailable.
- A confirmed current self-removal event retires the exact stale route if that
  can be done without introducing new state or weakening event-order safety.
- Active groups retain the existing listing, clarification, and exact-ID
  handoff behavior.
- Focused deterministic tests, typecheck, and a focused real-Codex journey pass.

## Scope

- In scope: Linq chat usability derivation, joined-group inventory, handoff
  admission, exact self-removal route retirement when safely fenceable, focused
  tests, assistant journey, and member-visible changelog entry.
- Out of scope: participant-name matching, digests, historical backfill, new
  route state, delivery-receipt infrastructure, or changing product membership
  semantics.

## Constraints

- Technical constraints: provider calls stay outside database transactions;
  the existing locked durable-route revalidation remains the final enqueue
  fence; list fanout remains bounded; no provider state is copied into a second
  source of truth.
- Product/process constraints: Product UX patch only; preserve the ordinary
  active-group path; use synthetic non-identifying fixtures; do not claim queue
  admission is delivery completion.

## Risks and mitigations

1. Risk: an old self-removal event could retire a rejoined route.
   Mitigation: retire only the exact current route when provider event identity
   and ordering data can fence it; otherwise rely on the live provider check.
2. Risk: participant-roster failure gets confused with send availability.
   Mitigation: model them as separate response fields with independent reasons.
3. Risk: removal between preflight and send still races.
   Mitigation: keep provider send authoritative and replies truthful about
   queue admission; do not add a new cross-runtime completion system here.

## Tasks

1. Confirm the current route, provider-summary, webhook, and response-contract
   owners and prove the narrow failure path with focused tests.
2. Add one canonical live provider-chat usability derivation and reuse it in
   inventory and handoff admission.
3. Retire exact routes on safely fenceable self-removal events, or document why
   live validation is the safer sole owner.
4. Add deterministic boundary coverage and a focused real-Codex journey for an
   unavailable candidate alongside an available group.
5. Walk the affected member journeys, add the changelog entry, and inspect the
   final diff for simplicity and private-data leakage.
6. Run focused verification, create the scoped commit and draft PR, complete
   required specialist/final review and CI, then merge and verify deployment.

## Decisions

- Treat this as a Product UX Patch: it restores the existing promise that an
  available destination is actionable.
- Keep action availability distinct from participant-roster availability.
- Reuse live provider truth before the database-only route lock; do not create
  a second durable availability field or asynchronous completion queue.

## Product UX walkthrough

- Active destination: it remains selectable and keeps its safe participant
  count and labels.
- Departed destination: it remains identifiable in inventory but is not offered
  or accepted for a new consultation.
- Ambiguous person cue: clarification considers only usable destinations, so a
  stale chat cannot win by title or participant similarity.
- Temporary provider or address-book failure: the affected roster details
  degrade independently while an otherwise authorized route remains usable.
- Leave and later rejoin: the opaque membership generation remains the model's
  selection fence, and a delayed provider removal cannot retire a route updated
  after that event.

## Verification

- Passed focused Web provider/list/handoff/webhook tests: 6 inventory, 36 Ask
  and handoff, 4 membership-admission integration, 166 group-tool, 20 route,
  and 33 webhook cases.
- Passed the hosted-execution package suite: 53 files and 562 tests.
- Passed the assistant prompt regression: 19 tests.
- Passed the focused real-Codex journey: the model listed memberships, skipped
  the unavailable synthetic candidate, and handed off once to the available
  opaque membership without exposing its identifier.
- Passed hosted-execution, assistant-engine, hosted-web, and Cloudflare
  typechecks.
- Passed the focused Cloudflare runner protocol test: 202 cases.
Completed: 2026-08-28
