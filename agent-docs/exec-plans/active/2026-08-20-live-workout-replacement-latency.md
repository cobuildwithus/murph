# Live workout replacement latency

## Goal

Restore the existing private live-workout promise: after a member explicitly
approves deleting one exact active workout and starting a named replacement,
Murph performs the guarded replacement and returns the verified workout card
without serializing the setup across repeated full-vault CLI invocations.

## Evidence

- A production turn spent about 100 seconds in the provider boundary.
- Eight command executions accounted for about 88 seconds; five commands each
  took roughly 15–20 seconds.
- Ingress, runtime admission, outbox handoff, and provider delivery were not the
  bottleneck, and no runtime error was recorded.
- The current tracked-workout flow requires an active read, deletion, start,
  and one mutation per initial exercise.

## Product UX

- Outcome: an explicitly approved workout replacement reaches a verified new
  live workout and refreshed card with one assistant command.
- Reaches: existing private iMessage live-workout replacement after one narrow
  confirmation; ordinary starts, updates, finishes, and ambiguous cases retain
  their current behavior.
- Proof: a production-shaped CLI scenario proves one exact active workout is
  replaced, all requested initial exercises exist, failure leaves the old
  workout unchanged, and the assistant skill selects the compound surface.

Classification: Product UX Patch.

## Constraints

- The canonical workout event remains the only mutable authority.
- Replacement requires one proposal-time active workout id and lifecycle
  revision plus explicit member intent to delete that snapshot; missing,
  completed, changed, or competing active workouts fail closed.
- Validate the complete replacement before the first canonical write.
- Commit the old-workout tombstone and new-workout event atomically through the
  existing canonical event owner; do not add runtime state, a queue, or a
  second workout owner.
- Keep command telemetry content-free; do not add argv, message text, paths, or
  identifiers to logs.

## Plan

1. Add a core-owned atomic event replacement primitive and focused rollback,
   audit, and hosted-write receipt proof.
2. Add one live-workout replacement use case that revalidates the exact active
   workout and proposal-time revision under the existing workout lock and
   constructs initial placeholders before calling the core primitive.
3. Expose the narrow `vault-cli workout replace` command with repeated bounded
   initial-exercise specifications.
4. Update tracked-workout guidance and focused prompt coverage so the explicit
   confirmation path uses that one command.
5. Run focused core, use-case, CLI, assistant-skill, generated-artifact,
   typecheck, and direct built-CLI proof; then complete the required PR reviews
   and exact-head CI.

## Deployment

The CLI, assistant guidance, and hosted runner bundle must deploy together.
Older runner bundles remain compatible because existing commands are unchanged;
the new skill guidance must not reach a runner that lacks the new command.

## Product UX Walkthrough

Ready. The affected person is a private messaging member who has already asked
to replace one blocked live workout with a fully specified ad-hoc session and
explicitly approved deleting the exact old snapshot. The replacement command
revalidates the proposal-time sole active id and revision, commits the old
tombstone and complete new workout together, and returns the new canonical
record for the ordinary workout-card response. Missing confirmation,
a different or changed active workout, and multiple active workouts remain
fail-closed. If hosted recovery restores the atomic commit but loses the command
result, an identical approved replay returns the existing exact replacement
without another event or audit write. Saved-routine replacement and a combined
replacement-plus-completed-set write are intentionally outside this patch.

## Verification

- Passed package typechecks for core, vault use cases, and CLI.
- Passed the focused core replacement tests, including hosted receipt replay,
  injected persistence rollback, and stale-revision rejection.
- Passed the focused CLI live-workout tests, including explicit confirmation,
  exact replacement, competing-active failure, and rejection of a proposal-time
  revision after an intervening edit without a tombstone or replacement event.
- Passed the tracked-table skill regression tests.
- Added a real-model conversation regression for proposal, intervening edit,
  failed stale approval, fresh proposal, and successful replacement. The suite
  typechecks, but live execution is unavailable in this checkout because its
  required provider API key is not configured; the runner fails before a model
  turn begins.
- Passed the changelog-fragment generation and focused validation tests for the
  member-visible performance item.
- Passed the incremental workspace build, generated CLI artifact refresh, and
  CLI package-shape verification.
- Passed a direct built-CLI journey: start the old workout, replace it once with
  two initial exercises, reject the old id as active, and resolve the replacement
  as the sole active workout.
- Merged current `origin/main` through ordinary history and regenerated the
  combined CLI artifacts. The only conflict was the generated CLI skill hash.
- Passed a normalized complete first-provider-request capture against current
  base and merged head with the pinned real Codex App Server, hermetic Responses
  stub, `gpt-5.6-terra`, low reasoning, production code mode, identical synthetic
  direct/group workout-replacement turns, and `gpt-tokenizer` 3.4.0
  `o200k_harmony`. The selected provider fields were `include`, `input`,
  `instructions`, `parallel_tool_calls`, `text`, `tool_choice`, and `tools` when
  present; generated ids and temporary paths were normalized identically. Direct
  changed from 27,715 tokens / 124,707 UTF-8 bytes to 27,718 / 124,718 (+3
  tokens / +11 bytes), entirely from adding `replace` to the CLI workout-family
  index. Group remained 22,503 tokens / 103,537 bytes. Tool/schema guidance and
  all other first-request fields were unchanged. The deferred tracked-table skill
  changes from 5,254 tokens / 26,607 bytes to 5,565 / 28,219 (+311 / +1,612)
  only when selected and read; it is absent from the first request.
- Preliminary specialist ReviewGPT found that the first candidate derived the
  destructive revision after approval and scoped the prompt too broadly. The
  remediation now carries the proposal-time revision through the CLI and core
  boundary, rejects changed state without mutation, and gives saved-format and
  exact-reference reminder flows explicit precedence.
- Final ReviewGPT round 1 found that a set-valued repeatable-option normalizer
  could deduplicate an ordered A/B/A exercise plan and reject comma-bearing
  exercise names. The correction passes the CLI typecheck, package-shape check,
  and seven focused CLI tests, including exact ordered duplicates and a comma-
  bearing name on the sole replacement event.
- Final ReviewGPT round 2 found that a committed replacement restored after
  result loss could reject the identical approved replay because the old id was
  no longer active. The correction recognizes only an exact sole-active match,
  returns its canonical id with `created: false`, performs no additional event
  or audit write, and still rejects a same-title request with different exercise
  state. The focused CLI suite also applies the captured hosted receipt to a
  pre-commit replica before replaying the original command.
- Final ReviewGPT round 3, exact-head CI, and plan closure remain pending.
