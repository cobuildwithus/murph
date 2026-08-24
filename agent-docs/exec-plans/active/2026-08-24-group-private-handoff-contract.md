# Restore group-to-private handoff continuation

Status: active
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Make the existing group consultation tool select the correct current-sender
  action for fresh private handoffs, missing-detail questions, and later
  clarification answers.
- Preserve the current Web-owned authority, persistence, routing, and delivery
  boundaries without adding state or fallback behavior.

## Product UX Patch

- Outcome: a group participant can complete an existing private-Murph handoff
  after Murph asks for one missing detail, without receiving a false failure.
- Reaches: the existing group conversation path that either has a complete
  private handoff now or needs one user answer before choosing its destination.
- Proof: the provider-visible tool contract distinguishes fresh requests from
  persisted clarification continuations, focused tests lock that contract, and
  existing execution tests continue to prove server-side authority and mutual
  exclusion.

## Scope

- In scope: the `group_consult` tool description, focused prompt-contract
  coverage, provider-input measurement, and a public changelog item.
- Out of scope: new actions, new persisted state, retries, server authority,
  private-route selection, delivery transport, and changes to group notices.

## Constraints

- A fresh complete private handoff uses the existing new-request action.
- A follow-up question that must survive into the next message first persists
  the existing clarification request.
- Continuation actions are reserved for a later message answering a successfully
  persisted clarification.
- Accepted handoff remains queued rather than claimed as sent.
- Keep the provider-visible instruction concise and within the existing tool
  description budget.
- Preserve unrelated worktree state and use the task worktree/PR lane.

## Tasks

1. Tighten the existing `group_consult` description at its current owner.
2. Add focused contract coverage for fresh, clarification, and continuation
   selection semantics.
3. Run focused tests and typecheck, measure provider-input impact, complete the
   Product UX walkthrough, and inspect the final diff.
4. Commit and push the candidate, open the PR, and run the required preliminary
   Product UX, prompt, and coverage ReviewGPT lenses concurrently with CI.

## Verification

- Focused assistant tool-description and current-sender tests.
- Assistant Engine typecheck.
- Provider-visible description byte and route-wide budget comparison.
- `git diff --check` and privacy-sensitive diff inspection.
- Exact-head CI and preliminary specialist ReviewGPT pass.
