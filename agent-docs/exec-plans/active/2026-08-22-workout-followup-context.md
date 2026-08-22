# Preserve exact workout identity across follow-up prompts

Status: active
Created: 2026-08-22
Updated: 2026-08-22

## Goal

- Let Murph carry the exact canonical workout id it already resolved into the
  durable context of a plain-text follow-up question.
- Keep the id hidden from the member and reuse the existing transcript as the
  only continuation owner.

## Product UX Patch

- Outcome: a member can answer Murph's next-set question normally and have the
  result saved to the exact workout Murph asked about.
- Reaches: the existing private live-workout conversation when Murph asks a
  workout-specific follow-up without sending a structured card.
- Proof: a production-shaped response turn hides the exact id from delivered
  text, preserves it in transcript context, and a fresh provider turn can use
  that context instead of selecting a workout by recency.

## Scope

- In scope: one transcript-only workout-id marker for model-authored follow-up
  text, final and steered-response handling, tracked-workout instructions and
  product contract, focused regressions, and a public changelog item.
- Out of scope: global active-workout state, recency selection, new persisted
  workout state, card behavior, workout schemas, or changes to canonical write
  authority.

## Constraints

- The marker carries only a valid canonical `evt_<ULID>` returned by the
  current exact workout command result.
- Delivery strips the marker; durable assistant transcript text retains it.
- The marker is context, not write authority. Every later mutation still
  exact-reads and targets that id through the canonical workout owner.
- Preserve unrelated working-tree state and use the task worktree/PR lane.

## Tasks

1. Add the smallest final-response transform that separates visible follow-up
   text from transcript-only exact workout context.
2. Teach the tracked-workout owner to append that context only when asking for
   a reply about one exact workout.
3. Add focused runtime, prompt-contract, and fresh-thread regression proof.
4. Run focused tests and typechecks, complete the Product UX walkthrough,
   inspect the diff, and execute the required PR review and CI gates.

## Verification

- Focused assistant-engine runtime and tracked-table tests.
- Assistant Engine and Operator Config typechecks if their production owners
  change.
- `git diff --check` and identifier/privacy scan.
- Exact-head CI and the preliminary Product UX, prompt, and coverage ReviewGPT
  lenses.
