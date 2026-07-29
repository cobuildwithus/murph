# One-time current-sender self-disclosure in authenticated group chat

## Outcome

An authenticated participant in a non-direct Murph group conversation can
explicitly ask Murph to disclose that participant's own private data to that
same conversation without first creating a hosted-group membership or standing
disclosure grant.

The model selects only an exact accepted message from the current group turn.
Web reopens the authoritative encrypted wake, resolves the provider-authenticated
sender, derives the exact question and a fixed self-only disclosure boundary,
and reuses the existing read-only Assistant Ask candidate/reviewer/delivery
lifecycle.

## Protected invariants

- A message ref is an opaque selector, never authority. It must bind to an
  accepted input in the active root group turn and be revalidated against the
  current route.
- Sender identity comes only from the provider-backed Web resolver for the
  exact stored wake. Model arguments, display text, roster order, and hidden
  analytics attribution do not confer authority.
- The one-time authority can disclose only the exact sender's own data, only
  to the extent directly requested by the exact stored message, and only back
  to the originating conversation.
- The personal runtime remains isolated, read-only, capability-free, and
  subject to the existing fresh outgoing disclosure reviewer.
- No membership, grant, permission row, queue, scheduler, workflow, service,
  or database table is introduced.
- Direct, email, unresolved, cross-runtime, expired, stale-route, scheduled,
  media-only, and over-limit inputs fail closed.

## Current owners and evidence

- `packages/assistant-engine` owns model-visible group-tool admission and
  current-turn accepted-input selection.
- `apps/web` owns the encrypted source wake, current provider route and sender
  identity, active personal runtime, Assistant Ask request lifecycle, and final
  disclosure authority.
- `packages/hosted-execution` owns strict cross-plane contracts and parsers.
- `packages/assistant-runtime` owns isolated personal-vault candidate/reviewer
  execution and mailbox lifecycle handling.
- The existing `consented_member` Assistant Ask path already proves the
  candidate/reviewer/exact-delivery primitive. The missing product path is
  one-time first-party admission derived from an exact authenticated group
  message rather than a standing grant.
- The supplied patch is behavioral intent only and will be reconciled against
  the current owners and tests before landing.

## Smallest architecture

1. Add `ask_current_sender(messageRef)` to the existing `murph.group` action
   union.
2. Add one typed `group_sender` Assistant Ask target.
3. Reopen the exact accepted wake on Web and derive target, question,
   permission, origin, and delivery from server-owned facts.
4. Reuse the existing request/completion mailbox pair, detached read-only
   personal candidate, outgoing reviewer, and exact-origin delivery.
5. Extract only the provider-backed sender resolver or exact authored-text
   projection where current duplication would otherwise let authority drift.

## Failure, replay, and deployment

- Deterministic request identity pins one originating accepted input to one
  target. Exact replay is idempotent; changed target metadata conflicts.
- Existing Assistant Ask expiry, mailbox retry, completion dedupe, and final
  egress reauthorization remain the only lifecycle owners.
- Parser and runtime-consumer support must deploy before model/tool admission
  is exposed. The final PR will document the exact Web/runner compatibility
  window and rollback floor proved by the implementation.

## Proof

- Focused contract/parser, assistant-tool, Web authority/idempotency,
  detached-runtime, and group-tool tests.
- Canonical `pnpm verify:acceptance` because this spans Web, hosted contracts,
  assistant engine/runtime, privacy authority, and delivery behavior.
- Direct code-path scenario proving exact stored text and provider-authenticated
  sender resolution feed the existing reviewed personal disclosure lane.
- Local product-experience review for the one-time permission/delivery journey.
- Preliminary `completion-specialists` ReviewGPT coverage/prompt pass on an
  exact pushed head, followed by parent final review.
- Final ReviewGPT PR loop through `ROUND_OUTCOME: PASS` with zero accepted
  findings and green CI.
Status: completed
Updated: 2026-07-27
Completed: 2026-07-27
