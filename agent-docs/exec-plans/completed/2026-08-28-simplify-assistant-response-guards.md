# Simplify assistant response guards

Status: completed
Created: 2026-08-28
Updated: 2026-08-28

## Goal

- Let a later live-steered context finish without another reply while preserving
  an earlier answer that is already the correct response to the earlier input.
- Reject delayed response media when accepted input has advanced, matching the
  existing response-card boundary.
- Delete duplicate response-card and response-media conflict checks from the
  private patch applicators while preserving the existing public tool contract
  and final delivery invariant.

## Product UX Patch

- Outcome: fast follow-ups keep the answer they need, acknowledgements can stay
  quiet, and late attachments never land on the wrong reply.
- Reaches: the existing private-direct live-steering journey when a member sends
  another message before the current Codex turn finishes.
- Proof: focused deterministic steering regressions plus one private-free real
  Codex journey that inspects the actual reply and final effects.

## Scope

- In scope: response patch acceptance in Assistant Engine, focused deterministic
  coverage, one real-Codex journey, and one public changelog fragment.
- Out of scope: prompts, tool schemas, provider delivery, persisted state,
  response-card rendering, media preparation, and group or scheduled behavior.

## Constraints

- Preserve current-context equality for cards, text recovery, and media.
- Preserve accepted-no-reply, response-media cardinality, required vault-file
  approval, and final card-versus-media delivery boundaries.
- Keep conflict validation at the dynamic-tool owner instead of duplicating it
  inside private patch applicators in the same serialized trust domain.
- Preserve unrelated worktree state and use the task worktree/PR lane.

## Tasks

1. Remove the two earlier-context no-reply rejections, add response-media context
   equality, and delete duplicate private conflict checks.
2. Update focused deterministic steering coverage, including delayed old media
   after accepted live steering.
3. Add and run a focused private-free real-Codex journey; inspect the actual
   response and effects.
4. Run focused tests and typecheck, inspect the privacy-safe diff, commit and
   push a draft PR candidate, then add the PR-linked changelog fragment.
5. Run the preliminary completion-specialists pass and disposition it, then run
   the final ReviewGPT loop while CI runs.

## Review resolution

- Preliminary specialists found that the original real-Codex journey started
  steering after admission had closed and used test-only silence instructions.
  The focused proof was corrected to admit the acknowledgement before cutoff,
  and the real journey now uses unchanged production instructions and a natural
  acknowledgement.
- Final ReviewGPT round 1 found two production races: cumulative no-reply
  settlement could retire an earlier useful answer, and already-applied media
  could survive a later context advance. Both were accepted.
- The reply correction carries the exact preceding-reply ordinal, limits
  suppression to the silent suffix, defers that suppression until the earlier
  delivery is durable, and prevents empty-success recovery while the earlier
  reply remains undelivered.
- The media correction clears current response media on every accepted context
  advance after preserving it only for an actually completed earlier response.
- A fresh full round-2 audit of the corrected exact head returned
  `ROUND_OUTCOME: PASS` with no findings.

## Verification

- Focused Assistant Engine steering and response-tool tests.
- Assistant Engine typecheck.
- Focused real-Codex assistant journey.
- Changelog fragment test.
- `git diff --check` and privacy-sensitive diff inspection.
- Exact-head CI, preliminary specialist ReviewGPT, and final ReviewGPT round 1.

Completed proof:

- 460 focused tests across seven files passed.
- Assistant Engine typecheck passed.
- The focused real-Codex journey delivered the earlier `ORBIT.` reply once,
  emitted no final reply for the acknowledgement, and recorded one finish
  attempt.
- Exact-head required CI passed.
- Final ReviewGPT round 2 passed on commit
  `94a00376ea960e386f4794e9ac4be601b266e64b`.
Completed: 2026-08-28
