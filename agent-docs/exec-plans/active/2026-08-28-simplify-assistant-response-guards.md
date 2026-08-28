# Simplify assistant response guards

Status: active
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
   final ReviewGPT round 1 on the same Eragon lane while CI runs.

## Verification

- Focused Assistant Engine steering and response-tool tests.
- Assistant Engine typecheck.
- Focused real-Codex assistant journey.
- Changelog fragment test.
- `git diff --check` and privacy-sensitive diff inspection.
- Exact-head CI, preliminary specialist ReviewGPT, and final ReviewGPT round 1.
