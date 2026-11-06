# One owner per meal capture fact

Status: active
Created: 2026-11-05
Updated: 2026-11-05

## Goal

- A captured photo that repeats a meal already saved leaves Meals at closeout.
- The 9pm closeout finishes normally after it edits a capture.

## Success criteria

- No instruction or reader treats `source` as capture identity.
- `meal edit` no longer offers a source it would override.
- A real-model closeout deletes a repeated capture, leaves the saved meal
  unchanged, and stays silent.
- A real-model closeout keeps a different plate and completes its review.

## Scope

- In scope: the `automatic-meal-capture` skill and the guidance that restates
  it, the shared event edit options, and upload-link recovery.
- Out of scope: image matching at import, new commands or fields, and repair of
  notes already saved on older captures.

## Constraints

- Technical constraints: keep the host rule that any edit of a device row makes
  it `manual`; provider reconciliation depends on it.
- Product/process constraints: never delete on a guess or over a member-written
  note. When unsure, keep both.

## Risks and mitigations

1. Risk: the model deletes a different plate as a repeat.
   Mitigation: the existing rule requires inspection and forbids guessing, and
   the journey proves a different nearby meal survives. A wrong delete loses a
   photo-only stub, while the saved meal keeps its own record.
2. Risk: a day whose only captures repeat saved meals gets no closeout message.
   Mitigation: accepted. Closeout exists to resolve captures, and a day logged
   only through chat already gets none.

## Tasks

1. Remove `source` as identity from the skill and state the read-back result.
2. Add repeated captures to the existing delete rule.
3. Delete `--source` and `--clear-source` from the shared event edit options.
4. Delete the `source` check from upload-link recovery.
5. Prove the composed behavior with deterministic tests and a real-model journey.

## Decisions

- `externalRef` owns capture identity. `source` stays host-owned and records who
  owns the row. The model decides what a capture is.
- Rejected keeping `device` after an edit: it adds a special case to the generic
  edit path and weakens the provider reconciliation rule.
- Rejected deduping at import: the two copies are different files, perceptual
  matching needs a new component, and a time window would delete real second
  plates. The model already recognizes these repeats.
- Rejected a merge command or duplicate field: nothing else needs that state.

## Verification

- Commands to run: focused CLI, engine and Web tests, `pnpm complexity:diff`,
  `pnpm docs:drift`, and `pnpm test:assistant:live -- --test "counts a repeated capture once"`.
- Expected outcomes: all pass, and the printed replies meet the reply bar.
