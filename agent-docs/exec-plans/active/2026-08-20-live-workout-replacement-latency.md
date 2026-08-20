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
- Replacement requires one exact active workout id plus explicit member intent
  to delete it; missing, completed, changed, or competing active workouts fail
  closed.
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
   workout under the existing workout lock and constructs initial placeholders
   before calling the core primitive.
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
to replace one blocked live workout and explicitly approved deleting that exact
old session. The replacement command revalidates the sole active id and revision,
commits the old tombstone and complete new workout together, and returns the new
canonical record for the ordinary workout-card response. Missing confirmation,
a different or changed active workout, and multiple active workouts remain
fail-closed. Saved-routine replacement and a combined replacement-plus-completed-
set write are intentionally outside this patch.

## Verification

- Passed package typechecks for core, vault use cases, and CLI.
- Passed the focused core replacement tests, including hosted receipt replay,
  injected persistence rollback, and stale-revision rejection.
- Passed the focused CLI live-workout tests, including explicit confirmation,
  exact replacement, and competing-active failure.
- Passed the tracked-table skill regression tests.
- Passed the changelog-fragment generation and focused validation tests for the
  member-visible performance item.
- Passed the incremental workspace build, generated CLI artifact refresh, and
  CLI package-shape verification.
- Passed a direct built-CLI journey: start the old workout, replace it once with
  two initial exercises, reject the old id as active, and resolve the replacement
  as the sole active workout.
- Preliminary specialist ReviewGPT, final ReviewGPT, exact-head CI, and plan
  closure remain pending until the review candidate is pushed.
