# Merge a typed meal into its capture

Status: completed
Created: 2026-11-05
Updated: 2026-11-05

## Goal

- A pending capture that repeats a typed meal leaves one entry with the photo
  and the typed details, instead of one entry with no photo.

## Success criteria

- A real-model closeout copies the typed meal onto the capture, deletes the typed
  meal, then completes review, and the day counts the meal once.
- A failed delete leaves the capture pending and the next closeout finishes it.
- A provider meal, or a meal holding fields `meal edit` cannot set, is kept.

## Scope

- In scope: the `automatic-meal-capture` rule and the guidance that restates it.
- Out of scope: a host merge command, moving a photo between meals, and
  already-reviewed captures, which stay as they are.

## Constraints

- Technical constraints: photo manifests are owned by their meal id and
  `meal edit` cannot change attachments, so the capture is the entry that survives.
- Product/process constraints: never merge on a guess or over a capture with a
  member-written note. `meal edit` cannot set micronutrients, so a meal holding
  them is kept and the capture is deleted.

## Risks and mitigations

1. Risk: Murph deletes a meal the member logged.
   Mitigation: it needs inspected photo evidence of the same meal, its details
   are read back on the capture first, and doubt keeps both.
2. Risk: a failed delete leaves both entries with numbers, so the day counts
   the meal twice until the next closeout.
   Mitigation: edit comes first so no detail is lost, the capture stays pending,
   and the rule names that state so the next closeout resumes at the delete.
3. Risk: deleting a provider meal would invite re-import.
   Mitigation: the merge requires no `externalRef`.

## Tasks

1. Add the merge rule and exclude it from the delete rule.
2. Make the restating guidance defer to that rule.
3. Prove the command sequence, the merge, the resume and both guards.

## Decisions

- The capture survives rather than the typed meal. Moving a photo needs a new
  core operation that transfers manifest ownership; this reuses `meal edit` and
  `meal delete`.
- A typed meal is identified by no attachment and no `externalRef`, keeping
  `source` out of identity.

## Verification

- Commands to run: focused CLI and engine tests, `pnpm docs:drift`, and
  `pnpm test:assistant:live -- --test "merges a typed meal into its pending capture"`.
- Expected outcomes: all pass, and the printed replies meet the reply bar.
- Result: all passed on `gpt-6.1-sol` with local subscription auth, reply review Ready. The first live run found that a failed delete still reviewed the capture, which would have left the meal double-counted for good, so the rule and closeout step 5 now hold review.
- A Codex deep review found the merge could move nutrition across a local date, so it now requires the same local date. Dangling references to a deleted meal were left as they are: every `meal delete` already leaves them and no reader fails on them.
Completed: 2026-11-05
