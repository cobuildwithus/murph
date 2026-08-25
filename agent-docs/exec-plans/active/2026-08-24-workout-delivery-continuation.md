# Preserve workout identity across adjacent replies

Status: active
Created: 2026-08-24
Updated: 2026-08-25

## Goal

Keep consecutive terse set confirmations on the exact live workout created for
the current routine, even when an older unfinished workout has overlapping
exercise and set coordinates.

## Product UX

Effort: Patch. This restores the existing promise that one direct-message set
logging sequence stays on one exact live workout.

- Entry: a member replies to a workout-format reminder and then sends terse set
  completions such as `done` or `same`.
- Feedback: each acknowledgement describes progress on the exact workout that
  the current sequence created.
- Continuation: only the immediately preceding assistant delivery may carry an
  implicit activity-session reference into the next reply.
- Recovery: missing, multiple, or conflicting references fail closed so Murph
  asks or rereads canonical state instead of selecting by recency.

## Constraints

- Keep `workout_format` as reminder context and `activity_session` as canonical
  mutation truth.
- Add no active-workout table, global focus flag, timeout, recency selector,
  queue, or second workout mutation path.
- Reuse schema-validated CLI results, delivery ordinals, outbox context
  references, and the existing native-resume turn-context projection.
- Treat response cards as optional presentation, never identity authority.
- Preserve rolling compatibility with outbox intents that have no context
  references.

## Implementation

1. Derive at most one trusted `activity_session` reference per assistant
   delivery from a successful, schema-validated live-workout start.
2. Carry that reference forward only when a later successful workout result
   identifies the same trusted session; fail closed on disagreement.
3. Attach the derived reference to the exact outgoing delivery through the
   existing outbox context-reference field, including steered preceding
   responses.
4. Project implicit same-session context from only the latest prior assistant
   delivery so an unrelated assistant reply clears continuity naturally.
5. Remove the model-authored visible workout follow-up marker once the runtime
   owns the same relationship.

## Verification

- An older unfinished workout with matching exercise and set coordinates stays
  unchanged while consecutive terse confirmations update the newly started
  workout.
- Native provider resume receives the exact context reference without relying
  on transcript replay.
- A live steer cannot move a command result to a later delivery ordinal.
- Unrelated assistant output, invalid output, multiple IDs, and conflicts do
  not retain an implicit workout reference.
- Focused tests, affected package typechecks, exact-head CI, and required
  ReviewGPT gates pass before merge.

## Progress

- ReviewGPT confirmed the response-scoped delivery reference as the right
  architecture and rejected adding global active-workout state. Its two
  implementation findings were accepted: delivery references now have one
  per-ordinal owner with explicit inherit/clear/replace semantics, and batch
  parsing now uses the shared strict CLI contract plus the canonical command
  path resolver.
- The runtime derives continuity only from schema-validated workout command
  results. Start establishes identity, show/continue/edit may preserve it, and
  delete invalidates it. Conflicts clear the implicit reference.
- Product UX walkthrough: Ready. The reminder remains routine context, the
  first logged set establishes the exact activity session, and later terse
  replies receive that exact session reference without exposing internal IDs.
- Focused regression coverage passes for direct and batched workout results,
  option-first commands, delete invalidation, malformed batch output,
  response-specific delivery metadata, and live-steer ordinal isolation.
- `pnpm test:diff` passes on the corrected final tree, including affected
  typechecks, package-shape verification, package tests, package-boundary
  smoke tests, hosted web verification, and Cloudflare verification.

## Architecture decision

The durable relationship belongs to the assistant delivery that established
or preserved it. It is neither conversation-global state nor a prompt-visible
marker. Reusing the existing outbox context-reference channel keeps persistence,
trust, and native-resume projection in their current owners while the new
tracker remains a bounded, response-local reducer over validated CLI results.
