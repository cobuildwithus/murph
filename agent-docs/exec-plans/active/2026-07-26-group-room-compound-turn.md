# Collapse hosted group backlog into one attributable room turn

Status: active
Created: 2026-07-26
Updated: 2026-07-27

## Goal

- When several already-durable messages from one authenticated group room are
  released together, Murph sees one compound room turn and sends at most one
  conversational reply for that admitted batch.
- Preserve every admitted message as separately attributable evidence so Murph
  can answer multiple people naturally and participant-specific actions can be
  authorized from the exact request-bearing message.

## Success criteria

- Exact-successor group messages in one room batch across sender and native
  reply-anchor changes without changing direct-conversation batching.
- Prompt input retains each message's sender, opaque accepted-message ref, and
  native reply context; mixed group turns do not pretend the first sender owns
  the whole turn.
- `revoke_own_email_share` and other participant-specific group effects use an
  exact accepted `message_ref`; runtime code reloads and revalidates that
  accepted message, then Web derives the canonical member from trusted sender
  evidence.
- One group batch produces one provider turn and one normal outbox reply while
  terminal evidence covers every admitted input.
- Existing conversation, route, account, audience, causal-sequence,
  projection, reaction, and batch-size boundaries remain fail-closed.
- Focused regressions, the canonical diff lane, acceptance verification,
  product review, preliminary specialist review, parent review, final
  ReviewGPT, and CI all pass.

## Scope

- In scope:
  - Assistant Engine group input grouping, live-turn admission, prompt
    attribution/reply context, effect identity, and focused tests.
  - Hosted runtime/Web participant-specific effect contracts required to bind
    an action to one accepted group message.
  - The smallest durable architecture/security/reliability/product docs needed
    to describe the new current behavior.
- Out of scope:
  - New queues, backlog modes, room-overtake state, participant turns, or
    user-visible suppression state.
  - Global changes to direct-message batching.
  - Model-supplied canonical member ids or durable identity projections in the
    assistant runtime.
  - Unrelated mailbox-consumption work owned by the existing Part 1a plan.

## Constraints

- Technical constraints:
  - Web/Postgres remains the canonical owner of hosted membership and email
    sharing; assistant input state remains execution evidence only.
  - The model may choose only an opaque accepted `message_ref`. It cannot choose
    a member id or provider message id.
  - Preserve the existing exact accepted-message resolver and extend/reuse it
    instead of creating a parallel identity resolver.
  - One admitted input batch must remain bounded to 50 exact-successor messages.
- Product/process constraints:
  - Every accepted message reaches a durable terminal disposition; collapsing a
    provider turn must not silently discard other participants' requests.
  - Prefer deletion and direct data flow over compensating state.
  - ReviewGPT authors the initial implementation patch and must attach its
    current compilable WIP patch if it cannot finish within its time limit.

## Risks and mitigations

1. Risk: Mixed-sender batching weakens participant-specific authorization.
   Mitigation: Require an exact accepted `message_ref`, revalidate it at the
   runtime boundary, and derive the member only from trusted provider sender
   evidence inside Web.
2. Risk: Widening group batches merges unrelated rooms or causal gaps.
   Mitigation: Change only the authenticated group-room policy while retaining
   exact conversation, route, account, audience, positive successor, projection,
   reaction, and size boundaries.
3. Risk: The replacement grows into another backlog state machine.
   Mitigation: Reject room-overtake/defer/suppression machinery; express the
   behavior through selection, existing per-input metadata, and existing
   accepted-message authority.
4. Risk: Independently deployed runtime and Web disagree on a new tool request
   field.
   Mitigation: Keep any wire evolution additive and fail-closed, document the
   safe deploy order and rollback floor, and cover old/new skew where it can
   exist.

## Tasks

1. Package the clean current branch and ask the existing ReviewGPT Pro thread
   to implement the deletion-first design as an attached patch.
2. Inspect the returned patch as untrusted intent, reject unnecessary
   machinery, and apply only path-scoped changes.
3. Complete group-room batching and per-message prompt/reply-context behavior.
4. Complete exact-message participant effect authority for email-share
   revocation and any already-shared group effect with the same flaw.
5. Add focused static and runtime regressions for batching, prompt attribution,
   exact-message authority, idempotency, and failure behavior.
6. Update live owner docs, run the required product and completion reviews,
   close the plan, commit/push, open the replacement PR, and complete final
   ReviewGPT plus CI.

## Decisions

- The obsolete one-reply-then-suppress PR was closed; it is not a compatibility
  target.
- The room is the provider-turn/session unit for authenticated group chat.
  Individual accepted messages remain the evidence and action-attribution unit.
- Direct conversations retain their existing actor/reply-anchor grouping policy.
- No canonical/model-supplied member id enters assistant input or tool arguments.
- Web temporarily accepts the legacy self-opt-out and group-call requester
  fields only at the old-facing control-plane boundary so Web can deploy before
  independently updated runners. New runners send exact accepted-message
  participant evidence; the compatibility fields can be deleted after warm old
  runners drain.
- An authenticated inbound group message is current participation proof for a
  participant-specific effect. Do not require a best-effort stored group roster
  row because Telegram roster projection is incomplete.

## Progress

- ReviewGPT returned an attached implementation patch. The patch was applied,
  inspected, and narrowed where it changed existing phone-call participation
  semantics.
- Focused tests prove that mixed actors and reply anchors enter one turn with
  one send, live-steered accepted refs remain available to participant effects,
  and email-share revocation fails closed for missing or mismatched refs.
- Product-experience review found one stale iMessage-only opt-out instruction;
  the product spec and group-chat skill now both describe authenticated
  Linq/iMessage and Telegram message authority.
- Preliminary ReviewGPT accepted the architecture and identified two coverage
  gaps. Focused Web tests now cover the temporary legacy group-call requester
  fallback for Linq and Telegram, including wrong-route, ambiguous-requester,
  and inactive-member rejection.
- The registered hosted-local usage scenario now proves that three durable
  blocked group messages from two senders and two native reply anchors resume
  as one provider request and one outbound reply, retain three exact
  `message_ref` values with sender/reply context, and all reach consumed
  mailbox state.
- The first full canonical pass proved all guards, typechecks, Assistant Engine,
  Assistant Runtime, CLI, and Hosted Execution owners green. The downstream
  hosted-local owner then stopped at its pre-existing missing-dist preparation
  guard before exercising task code. Building the package directly resolved
  the local prerequisite; final canonical verification will run again on the
  completed patch.

## Verification

- Commands to run:
  - Focused Assistant Engine and hosted Web tests selected from the returned
    patch and final touched call paths.
  - `pnpm hosted-local e2e usage-limit-ambiguous-send --no-bundle`
  - `pnpm test:diff <touched owner paths...>`
  - `pnpm verify:acceptance`
  - Required product-experience, preliminary `completion-specialists`, parent,
    final ReviewGPT, CI, and clean-merge checks.
- Expected outcomes:
  - A rapid exact-successor group backlog across several senders and native
    anchors becomes one accepted provider turn and at most one normal reply.
  - Every admitted message remains visible and attributable, and an exact
    request-bearing message authorizes only that participant's effect.
  - Direct-message behavior and all route/audience/causal boundaries remain
    unchanged.
