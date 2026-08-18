# Roll over completed live workouts

Status: active
Created: 2026-08-17
Updated: 2026-08-18

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
  results; do not infer actual set values from plans; avoid queues,
  compatibility machinery, or a second state owner; keep the one demonstrated
  scheduled-rollover replay receipt distinct from native member-action replay;
  keep failure exits recoverable.
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
- The preliminary specialist pass on the first pushed candidate found that its
  retry marker overwrote native workout-card action replay, model-visible
  timestamps acted as effect authority, the composite public CLI conflicted
  with the ordinary workout command contract, and the exact reply-to-card path
  lacked one joined proof. All four findings were accepted. Remediation adds
  one narrow optional scheduled-rollover receipt, binds one opaque operation id
  to the exact accepted input in the host, replaces the public CLI with one
  availability-scoped dynamic tool, and adds joined host-tool/vault/card proof.
  The first specialist artifact could not formally attest model confirmation,
  so the corrected pushed head still requires a fresh specialist pass.
- The corrected specialist pass accepted three findings: bind replay to the
  exact routine, coordinate, and result; distinguish workout reminders from
  generic automations in persisted authority; and replace stitched mocks with
  a real scripted provider boundary plus a generic-reminder negative. Final
  ReviewGPT round 2 independently found the same replay defect, the missing
  same-session exact-reply authority path, and two PR-description discrepancies.
  The required anomaly retrospective was recorded before remediation. The
  redesign stays within existing automation, reply, tool, and vault owners.
- Final ReviewGPT round 3 found one remaining semantic-replay edge: an omitted
  set unit inherited from the exercise and the same explicitly supplied unit
  rendered the same workout but produced different receipts and equality
  checks. The finding was accepted. One canonical effective-set projection now
  drives both receipt derivation and retry comparison; focused proof covers
  inherited-to-explicit and explicit-to-inherited retries after close, start,
  and set-log persistence, while a genuinely different unit still fails closed.
- Final ReviewGPT round 4 accepted two findings. First, global provider-message
  ambiguity could disappear after current-session filtering and revive workout
  authority from an older reminder. Global exact resolution is now the sole
  authority source; the session boundary only controls optional prior context.
  Second, a provider-native reply can be accepted just before the outbound send
  returns and stamps local `sentAt`. Host and vault validation now share the
  existing 30-second bounded clock-skew policy while retaining both one-hour
  freshness bounds. Focused proof rejects current/older-session duplicate
  targets, accepts a one-second send-ack inversion through the real provider,
  vault, and card path, and rejects a 31-second inversion before mutation.
- Current focused proof passes 4 Assistant Engine files / 398 tests and the 11-
  case real Vault Usecases rollover suite. Typecheck passes for Contracts, Core,
  Query, Vault Usecases, and Assistant Engine; the incremental workspace build,
  CLI schema generation, and `git diff --check` pass after merging current
  `main`. Earlier package-shape and runner vault CLI bundle proof passed on the
  pre-merge candidate; both will be rerun before the next exact-head review.
- Complete first-provider request capture compares frozen base
  `17fa4a43091db5aa0d354bc26e4dacf908c26d80` with the remediated candidate using
  the pinned real Codex App Server, repository scripted Responses endpoint,
  `gpt-5.6-terra`, low reasoning, production code mode, and identical synthetic
  direct/group reply inputs. `gpt-tokenizer` 3.4.0 `o200k_harmony` counted the
  normalized serialization of present `include`, `input`, `instructions`,
  `parallel_tool_calls`, `text`, `tool_choice`, and `tools` fields; model,
  reasoning, storage, streaming, service-tier, cache/client/account, and
  transport metadata were excluded identically. The final tool-description
  substitution was replayed against that captured serialization after its
  runtime-only simplification. Direct changed from 27,683 tokens / 128,658
  UTF-8 bytes to 27,885 / 129,454 (+202, +0.7297%; +796 bytes, +0.6187%),
  entirely from the generated code-mode catalog entry for the availability-
  scoped rollover tool. Group stayed byte-for-byte identical at 24,256 tokens /
  113,505 bytes. Temporary capture code was removed.
