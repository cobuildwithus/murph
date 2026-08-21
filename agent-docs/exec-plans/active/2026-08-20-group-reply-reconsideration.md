# One-shot group reply reconsideration

Status: active
Created: 2026-08-20
Updated: 2026-08-21

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
- Keep, edit, reaction-only, and silence outcomes make only the latest selected
  terminal response canonical; provisional response segments, text, media,
  reactions, and no-reply evidence never leak or create another bubble.
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
  feature flags, effect reversal, and more than two provider requests.

## Constraints

- Technical constraints: keep the draft in memory; use the existing accepted-input
  journal ordinals and checkpoint hook; preserve provider-native continuation;
  defer only final conversational artifacts; keep completed external effects and
  progress messages authoritative; close admission atomically with the final
  source probe; never wait inside a database transaction.
- Product/process constraints: smallest maintainable owner extension, fixed
  approximately four-second hold, one terminal group action, no model-directed
  shell sleeps, no private evidence in fixtures or PR text, and merge only after
  the corrected exact head passes ReviewGPT and required CI.

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
   accepted findings, close the plan, push the final scoped commit, and merge.

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
- Round-4 accepted-input ownership retrospective: the original requirement is
  that request-1 failure leaves every source message retryable while no
  pre-commit conversational artifact becomes canonical. The current request-1
  shape exposed a second transcript owner: active-turn acceptance appended the
  original and late user messages before the fallible continuation completed,
  while the unchanged source events still owned retry. The decision is to keep
  source events plus the accepted-input journal/checkpoint as the only
  pre-commit recovery authority and let the existing selected-result commit
  boundary own user transcript appends and transcript refs for held group turns.
  Non-held live steering keeps its existing immediate persistence ordering. Do
  not add retry-time content matching, cleanup, tombstones, reconciliation, or a
  new durable state owner.

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
  cases, and a 375-test focused controller/prompt/planning/runtime regression set
  with the package's CI memory ceiling.
- Consolidated the new local-service scenarios into one module load; the exact
  CI-like 6 GB coverage invocation now completes all 104 tests in the large
  runtime file instead of exhausting the worker while rebuilding the same graph.
- Added and validated the `group-replies-follow-current-beat` changelog item for
  PR #2107; 57 focused changelog tests and the Web typecheck pass.
- Pinned real Codex App Server capture with identical synthetic direct/group
  turns and `gpt-tokenizer` 3.4.0 `o200k_harmony`: direct initial input is
  unchanged at 26,466 tokens / 121,426 UTF-8 bytes; group input moves from
  22,966 / 105,932 to 22,733 / 104,688 (-233 tokens / -1,244 bytes), entirely
  from removing the obsolete group cadence prompt. The temporary capture hook,
  captures, tokenizer install, and detached base worktree were removed.
- The preliminary ReviewGPT findings are triaged: the obsolete product matrix
  and prompt cadence language are removed, and reaction-only reconsideration is
  covered. The proposed host-side urgency/silence classifier was rejected because
  it conflicts with the explicit all-results-provisional invariant and would add
  a second policy engine while reintroducing premature no-reply commitment.
- Final ReviewGPT round 1's usage and request-1 progress findings remain accepted:
  usage records allocate turn-local monotonic ordinals independently from logical
  request ordinals, and targeted progress resolves accepted IDs through request
  1's absolute delivery context. Direct proof covers image/subagent/tool usage
  uniqueness and request-1 local target ordinals zero and one.
- Round 2 triggered the required selected-result retrospective. The original
  contract resolves it without a new mechanism: request 1 retains live steering
  until its first completed response, every pre-commit conversational segment is
  provisional, only the latest terminal response reaches the room, and keep is
  textual equivalence while exact rich-output reuse remains deliberately deferred.
  The round-1 segment-preservation correction and its incompatible expectations
  are reverted, restoring one selection owner and deleting behavior and proof.
- Round 3 confirmed the prior corrections and found one remaining provisional
  persistence leak. The finding is accepted: request 0's no-reply callback now
  leaves the initial user transcript, `user.persisted` receipt event, and
  accepted-input transcript reference untouched while a group reply remains
  held. Production-shaped proof covers abort/restart, terminal failure, and one
  canonical user write after retry without adding lifecycle state.
- Round 4 confirmed the prior corrections and triggered the accepted-input
  ownership retrospective above. Its finding is accepted: request-1 admission
  must not make user transcript state canonical while the selected result can
  still fail and leave the same source events retryable.
- Implemented the Round-4 decision by retaining held accepted inputs in memory
  and moving their existing transcript appends and journal-ref updates after
  `commit-started`. Non-held live steering keeps immediate persistence. A
  failed request 1 now writes zero user transcript entries or refs; a fresh
  successful retry writes the initial and late source messages exactly once.
  No content matching, cleanup path, lifecycle state, or durable owner was
  added.
- The corrected head passes all 104 local-service runtime tests with the
  repository-proven 6 GB heap, all 42 accepted-input journal/controller tests,
  the Assistant Engine typecheck, documentation drift, and diff checks. The
  default 4 GB combined focused invocation exhausted its test worker before
  reporting assertions; isolated focused runs and the full 6 GB runtime file
  pass.
- Remaining: commit and push the retrospective fix, run exact-head ReviewGPT
  round 5 concurrently with CI, close the plan, prove a clean current-base
  merge tree, merge, and confirm production rollout. The PR remains unmerged.

## Product UX walkthrough

- Quiet group participants: the provider completes once, the runtime performs
  one final source probe after the fixed hold, then one ordinary response enters
  finalization and delivery. The quiet Linq progress-path regression proves one
  provider request, one dispatch, and no new product state.
- Participants who add context during the hold: the new input is admitted and
  checkpointed through the existing path, request 1 resumes the same provider
  thread, and keep/edit cases each dispatch exactly one selected response.
- Participants who speak during reconsideration: the integration proof steers
  that input into request 1 before its first response and resolves every joined
  caller with the same final result; the provider-request count remains two.
- Participants who speak at the cutoff: paired controller cases prove input
  visible by the serialized final probe is reviewed, while input queued after
  that probe is not admitted into the closing turn and remains source-owned for
  the next turn.
- Failure and silence: request-1 failure rejects the joined turn without draft
  transcript, terminal evidence, or dispatch; selected silence commits one
  no-reply outcome and clears contradictory provisional response artifacts.
- Initial safety and silence: the host deliberately does not invent a second
  urgency or floor classifier. Request 0's text, reaction, or no-reply result is
  held under the same fixed four-second bound so late accepted context can be
  reconsidered once; a request-0 failure after provisional no-reply remains
  retryable rather than terminalizing an unselected decision.
- Excluded direct, email, scheduled, notification, and non-auto-reply journeys
  retain their existing eligibility path. No frontend presentation changes, so
  screenshots would not add evidence beyond the production-shaped timing and
  delivery tests.
- Walkthrough result: **Ready**. The implementation matches the approved product
  change with no added audience, permission, state, or recovery owner and no
  material difference from the plan.
