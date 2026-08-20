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
  all other first-request fields were unchanged. The tracked-table skill is
  deferred until selected and read, so its initial guidance plus later
  approval/recovery corrections remain absent from the first request.
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
- Final ReviewGPT round 3 verified the ordered-input and result-loss corrections,
  then returned the mandatory `ROUND_OUTCOME: RETROSPECTIVE_REQUIRED` gate before
  an ordinary audit. It reported no tactical code finding. The requirement-level
  decision below is recorded on the PR before the next substantive round.
- Final ReviewGPT round 4 accepted one review-induced consent finding: an exact
  active replacement candidate alone did not prove that the approved old workout
  was deleted. The correction now also requires the old event's latest canonical
  lifecycle to be `deleted` at exactly the approved revision plus one. Focused
  CLI proof rejects a merely completed old workout, a missing old event, a
  wrong-revision tombstone, and multiple active workouts even when the candidate
  looks exact, without adding event or audit rows. Core proof covers the expected
  tombstone after ordinary replacement and hosted receipt restoration.
- Final ReviewGPT round 5 reviewed exact pushed head
  `18734b89734e0f5490566118b7df69fc87816eac` for about 55 minutes with the
  requested compatible Pro model, verified every prior correction and the
  paired canonical proof, returned `ROUND_OUTCOME: PASS`, and reported no other
  qualifying issue.
- Passed final focused typechecks for core, vault use cases, CLI, and assistant
  engine; core replacement tests 3/3; CLI live-workout tests 8/8; tracked-table
  tests 8/8; changelog-fragment tests 7/7; 207-scenario integrity; incremental
  workspace build; and built CLI package-shape verification.
- All exact-head GitHub checks passed, including both CLI hosts, build/typecheck,
  assistant/CLI/platform coverage, app verification, release aggregate, runner
  budget, foreground-state, billing, fixture, artifact, PR-evidence, and
  marketing-overflow gates. The hosted-local Stripe browser matrix intentionally
  skipped and Vercel accepted the configured ignored build.
- A fresh fetch of current `origin/main` at
  `4f660db4ac39ff53df62963180b8d6c53f317003` produced a clean
  `git merge-tree --write-tree` result without updating the reviewed PR head.
  The final parent diff/privacy review found no remaining accepted issue or
  identifier leakage.

## Round 3 Architecture Retrospective

Continue the exact canonical-state convergence in the live-workout owner and
freeze its current narrow scope. Recovery after the atomic write commits but the
command result is lost is explicit for this compound command: the hosted receipt
restores canonical files, but it does not persist the domain return value, and a
foreground replay can invoke the approved command after replacement changed the
active event id.

From immutable first-reviewed head `f816b084c90558c217d2416b7111a0d6d357ef69`
to round-3 head `554ead3762ba97521b7cdec444a0a4aa1be1edf5`,
remediation changes eight files by +300 / -41 net. The ordered-input correction
was +58 / -10: it removed set-valued normalization from the CLI, added direct
ordered parsing proof, and added no owner. The result-loss correction was
+254 / -43: +127 / -22 in the vault use case, +104 / -13 in the hosted-recovery
CLI proof, and +23 / -8 in docs, prompt, and changelog coverage. Overlapping
changed lines explain the smaller aggregate net delta.

The existing canonical workout event, live-workout lock, canonical write lock,
hosted receipt/checkpoint, and restore path remain the only owners. The only new
feature concept is exact recognition of an already-applied replacement plus
no-write reconstruction of its ordinary `created: false` result. A generic
receipt-derived result would couple the vault use case to runtime artifact
state and still require domain interpretation; generic durable command-result
replay would add an operation identity and result lifecycle. The selected path
instead derives from the sole canonical authority under its existing lock and
fails closed on every nonmatch.

Do not add a generic result ledger, operation-id subsystem, runtime receipt
reader, queue, or retry loop in this PR. Remove the feature matcher when the
canonical-write/runtime boundary provides stable operation-id result replay, or
atomically persists canonical state, the tool result, and foreground-input
completion so post-commit command reinvocation cannot occur. Any cross-command
solution belongs in that separate owner-level design.
Status: completed
Updated: 2026-08-20
Completed: 2026-08-20
