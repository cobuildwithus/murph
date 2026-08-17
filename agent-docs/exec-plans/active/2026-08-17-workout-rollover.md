# Roll over completed live workouts

Status: active
Created: 2026-08-17
Updated: 2026-08-17

## Goal

- Let a member's unambiguous completion reply to a new scheduled workout
  reminder preserve and close a fully logged prior live session, start the new
  planned session, and record the intended set without an unnecessary
  clarification.

## Success criteria

- A prior live workout with zero pending sets no longer blocks a uniquely
  identified later workout occurrence.
- Rollover preserves every prior canonical exercise and set result and records
  a truthful bounded end time.
- The new workout and exact set completion are committed through the canonical
  workout owners with replay-safe behavior.
- A prior workout with any pending set, an ambiguous new routine or set, a stale
  reminder, or a completion lacking sufficient actual-result authority still
  fails closed without retargeting or inventing data.
- Focused production-path tests cover success, ambiguity, pending-prior,
  preservation, timing, and replay/failure behavior.
- Required ReviewGPT passes and exact-head CI are green.

## Scope

- In scope: canonical live-workout lifecycle, scheduled-reminder continuation
  guidance, direct-message completion resolution, focused tests, durable product
  specification, and a member-visible changelog entry when routed.
- Out of scope: repairing historical member records, changing generic workout
  import/history behavior, frontend UI, database schema, or adding a second
  workout state owner.

## Constraints

- Technical constraints: keep one canonical workout source of truth; preserve
  the existing live-workout mutation lock; do not delete or rewrite logged
  results; do not infer actual set values from plans; avoid new schemas, queues,
  receipts, or compatibility machinery; keep failure exits recoverable.
- Product/process constraints: the scheduled occurrence and current accepted
  reply must uniquely identify the new workout and set; terse completion may
  advance only that coordinate; private production evidence and member identity
  stay out of repository artifacts; ReviewGPT authors the candidate patch and
  Codex independently validates it.

## Risks and mitigations

1. Risk: automatically closing an actually unfinished session.
   Mitigation: admit rollover only when every canonical set is logged and the
   later scheduled occurrence uniquely identifies a distinct new workout.
2. Risk: inflating duration by ending the prior workout on the next day.
   Mitigation: derive the prior end boundary from existing canonical event
   timestamps rather than the later reply wall clock, and test the value.
3. Risk: partial close/start/log state after failure or replay.
   Mitigation: reuse the existing workout mutation owner and prove convergence
   at injected boundaries; do not add a parallel state owner.
4. Risk: stale reminder text retargets a different workout.
   Mitigation: require exact scheduled-occurrence and canonical routine/set
   resolution before mutation, preserving existing fail-closed rules.

## Tasks

1. [x] Package the proven root cause, user journey, invariants, and relevant owners
   for ReviewGPT and request a scoped implementation patch with tests.
2. [x] Inspect the returned patch path by path, reject unrelated changes, and apply
   only the smallest maintainable owner-boundary correction.
3. [x] Run focused unit/integration tests and a direct synthetic scheduled-reminder
   rollover scenario, then inspect the full base-to-head diff.
4. [ ] Commit, push, open the PR with the required intent and change-shape contract,
   and run the preliminary specialist and final cross-cutting ReviewGPT gates on
   the exact candidate head alongside required CI.
5. [ ] Resolve verified findings, merge when all required gates are green, and
   retire the clean worktree.

## Decisions

- Use the standard worktree/PR lane because the fix changes a user-facing
  persisted-state machine and prompt/tool continuation behavior.
- Require the final cross-cutting ReviewGPT gate because correctness depends on
  state ordering, replay, and fail-closed behavior across multiple owners.
- Treat the prior zero-pending workout as preserved history, never as a record
  to delete or overwrite.

## Verification

- Commands to run: focused `packages/vault-usecases`, `packages/cli`, and
  `packages/assistant-engine` Vitest slices selected after ReviewGPT's patch;
  affected package typechecks; `git diff --check`; direct synthetic rollover
  proof; exact-head required GitHub Actions.
- Expected outcomes: the unambiguous cross-day path closes the exhausted prior
  session, starts the intended routine, logs exactly one intended set, and
  preserves all prior results; every ambiguous, pending, stale, or replay path
  remains bounded and truthful.
- ReviewGPT authored the initial implementation patch. Parent inspection found
  and removed an unnecessary cross-routine restriction so a later occurrence of
  the same saved routine is also a valid rollover target.
- Focused vault-usecase rollover proof passes 3 tests, including the repeated
  routine regression. Focused CLI proof passes 4 tests, Assistant Engine proof
  passes 305 tests, operator contract proof passes 23 tests, changelog proof
  passes 45 tests, and affected package typechecks plus CLI package-shape and
  generated-schema checks pass.
- Complete first-provider request capture used the pinned real Codex App Server,
  the repository scripted Responses endpoint, `gpt-5.6-terra`, low reasoning,
  production code mode, identical synthetic direct/group replies, and
  `gpt-tokenizer` 3.4.0 `o200k_harmony`. It serialized `include`, `input`,
  `instructions`, `parallel_tool_calls`, `text`, `tool_choice`, and `tools` when
  present, normalized temporary paths and UUIDs, and excluded model selection,
  reasoning, storage, streaming, service tier, cache/client/account fields, and
  transport metadata identically. Direct changed from 24,679 tokens / 113,324
  UTF-8 bytes to 24,796 / 113,750 (+117 tokens, +0.4741%; +426 bytes,
  +0.3759%). Group remained 21,213 tokens / 97,995 bytes (zero delta). The
  direct delta is solely the runtime-authored reply authority in assembled input;
  the changed deferred CLI schema and tracked-table skill body were absent from
  the first request. Temporary capture code was removed after measurement.
