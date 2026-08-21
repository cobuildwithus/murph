# One-shot group reply reconsideration

Status: active
Created: 2026-08-20
Updated: 2026-08-20

## Goal

- Let an ordinary interactive Linq/iMessage or Telegram group turn hold its
  first completed response as an unsent in-memory draft for four seconds, then
  give Murph exactly one same-thread reconsideration when newer room input was
  accepted before the cutoff. Only the selected final response may reach the
  existing transcript, terminal-evidence, and outbox owners.

## Success criteria

- A quiet eligible group turn makes one provider request and creates at most one
  ordinary final reply intent after the fixed four-second hold.
- Same-room input before request 0's first response retains existing live-steer,
  journal, checkpoint, and delivery-context behavior.
- Same-room input accepted during the held-draft window creates provider request
  ordinal 1 in the same Codex thread with the engine-owned reconsideration
  instruction; request 1 is the hard cap.
- Keep, edit, reaction-only, and silence outcomes make only the selected request
  canonical; provisional text/media/reactions/no-reply evidence never leak.
- Request 1 failure never sends request 0's stale draft and leaves every accepted
  input on the existing retry path.
- The controller cutoff classifies racing input once as reconsidered now or
  pending for the next turn, without a new persisted state or delivery owner.
- Direct chats, email, scheduled output, notifications, and non-auto-reply turns
  retain current behavior.
- Focused Assistant Engine tests and typecheck pass; exact-head ReviewGPT gates
  and required PR checks pass before handoff.

## Scope

- In scope: active-turn admission/steering lifecycle separation, one serialized
  draft-window cutoff, local-service request selection and same-thread request 1,
  provider completion notification, group cadence prompt/spec deletion, focused
  controller/runtime/prompt/journal regression coverage, and the member-visible
  changelog entry.
- Out of scope: outbox or intent changes, schema/migration work, persisted drafts,
  reply-candidate or supersession models, queues/services, configuration or
  feature flags, effect reversal, more than two provider requests, and merge.

## Constraints

- Technical constraints: keep the draft in memory; use the existing accepted-input
  journal ordinals and checkpoint hook; preserve provider-native continuation;
  defer only final conversational artifacts; keep completed external effects and
  progress messages authoritative; close admission atomically with the final
  source probe; never wait inside a database transaction.
- Product/process constraints: smallest maintainable owner extension, fixed
  approximately four-second hold, one terminal group action, no model-directed
  shell sleeps, no private evidence in fixtures or PR text, and do not merge.

## Risks and mitigations

1. Risk: input races the four-second cutoff and is dropped or ambiguously owned.
   Mitigation: serialize the final source probe, pending-prefix read, close, and
   unregister decision with the controller's existing admission queue.
2. Risk: request-local delivery-context ordinals from request 1 target request 0
   inputs or effects.
   Mitigation: rebase request 1 callbacks and selected-result ordinals onto the
   existing turn-wide delivery-context arrays and cover live-steered request 1.
3. Risk: provisional no-reply, reaction, response segment, transcript, or outbox
   state becomes canonical before selection.
   Mitigation: suppress provisional terminal hooks, normalize the selected group
   result to one terminal action, and enter `commit-started` once after selection.
4. Risk: request 1 cannot resume the provider thread or fails after late input.
   Mitigation: build request 1's resume binding in memory from request 0; fail the
   ordinary turn without stale-draft fallback when continuation or request 1 fails.

## Tasks

1. Add the controller's separated response-completion and final-admission owners,
   including the abortable four-second serialized draft-window boundary.
2. Refactor local provider-request orchestration just enough to execute and
   account for request 0 plus one conditional request 1, select one normalized
   final result, and preserve the existing finalization/delivery path.
3. Remove the obsolete shell-sleep group cadence contract and document the live
   one-shot pre-commit owner and failure rules.
4. Add focused controller, local-service, provider, prompt, and journal proof for
   quiet, keep/edit/suppress, failure, live-steer, cutoff-race, scope, and cap
   scenarios.
5. Run focused proof and Product UX walkthrough, commit/push/open the draft PR,
   complete preliminary and final ReviewGPT gates plus required CI, resolve all
   accepted findings, close the plan, and push the final scoped commit.

## Decisions

- Product UX effort: Product change. This changes the timing and recovery meaning
  of an existing ordinary group-reply journey without adding an audience,
  permission, surface, data source, or durable product object.
- Product UX outcome: a quiet room receives one considered answer after a short
  predictable hold; a room that advances during the hold receives one answer to
  the current beat or deliberate silence, never the stale draft plus a correction.
- Entry and promise: an ordinary inbound message in an authenticated non-direct
  Linq/iMessage or Telegram room starts the existing auto-reply turn; the room may
  wait roughly four seconds after Murph first finishes drafting before the normal
  transcript/outbox destination receives the selected result.
- Affected people: quiet group participants; group participants who add context
  before the first response, during the held draft, during request 1, or after its
  cutoff; and people on excluded direct, email, scheduled, and notification paths.
- Recovery: request 0 failure keeps existing behavior; request 1 failure sends no
  stale draft and leaves all accepted messages retryable; post-cutoff input remains
  pending for the next normal turn.
- Rejected reply candidates, durable draft state, outbox supersession, a configurable
  deadline, and retry-until-quiet loops because the existing controller, journal,
  provider continuation, commit boundary, and outbox already own the required facts.

## Verification

- Commands to run: focused Vitest files for active-turn controller, local service,
  provider adapter, turn planning/model behavior, and accepted-input journal;
  Assistant Engine typecheck; documentation drift/reference checks; diff/privacy
  inspection; exact-head ReviewGPT specialist and final gates; required PR checks;
  current-base merge-tree proof.
- Expected outcomes: all focused and exact-head checks pass; direct scenario proof
  shows no more than two provider requests, one canonical final group action, no
  provisional final artifacts, no stale fallback on request 1 failure, exact race
  classification, and unchanged excluded journeys.

## Progress

- Implemented the controller lifecycle split, serialized draft-window cutoff,
  one optional same-thread continuation, selected-result normalization, and
  deferred no-reply commitment without changing the outbox or persisted schemas.
- Removed the model-directed shell-sleep cadence and updated the product,
  reliability, runtime-protocol, architecture, and documentation-index contracts.
- Added direct proof for quiet commit, pre-cutoff review, post-probe cutoff race,
  keep, edit, silence, request-1 live steering, the two-request cap, and
  request-1 failure without stale-draft delivery.
- Passed the Assistant Engine typecheck, the six highest-risk reconsideration
  tests, and a 294-test focused controller/prompt/planning/runtime regression set.
- Remaining: changelog item after GitHub assigns the PR number, provider-input
  measurement, exact pushed-head ReviewGPT and CI, finding remediation, parent
  final review, plan closure, and merge-tree proof. The PR remains unmerged.
