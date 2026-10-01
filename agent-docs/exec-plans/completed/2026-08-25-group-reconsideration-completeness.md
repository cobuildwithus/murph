# Preserve every accepted group request during reply reconsideration

Status: completed
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Preserve every independent request accepted into a rapid group turn, while
  allowing a later human correction to supersede only the detail it changes.
- Prevent provisional provider drafts and internal reconsideration guidance
  from remaining queryable in later turns.

## Success criteria

- Reconsideration sends the provider the cumulative accepted human input and
  selects exactly one final reply.
- The group prompt defines resolution and supersession only through later human
  messages, without treating an unsent assistant draft as a completed answer.
- A reconsidered turn clears its native provider resume state after committing
  the visible human messages and selected final response.
- Focused controller, prompt, persistence/planning, typecheck, and real-model
  checks pass; exact-head PR CI and required review gates are green.
- The merged public source is deployed through the protected Cloudflare
  production workflow and live rollout proof passes.

## Scope

- In scope: group auto-reply draft reconsideration, group turn prompt wording,
  provider resume cleanup, and focused regression coverage.
- Out of scope: direct-message behavior, delivery transport ownership, the
  four-second window duration, and unrelated provider routing.

## Constraints

- Technical constraints: keep the current single-turn controller and delivery
  owner; do not add a queue, state machine, dependency, or second transcript.
- Product/process constraints: preserve one reply for the group beat, retain
  correction semantics, avoid repeating completed effects, and use the PR plus
  protected production-deploy lanes.

## Risks and mitigations

1. Risk: cumulative input can duplicate the first request in the resumed native
   provider thread.
   Mitigation: explicitly instruct the model to replace the draft with one final
   result, then prove the behavior with the real GPT-5.6 Sol bridge.
2. Risk: clearing resume state could discard visible conversational context.
   Mitigation: persist both accepted human messages plus only the selected final
   response, then prove the next plan rebuilds that exact visible history.
3. Risk: ordinary group turns could lose warm provider continuity.
   Mitigation: clear only when the controller actually ran request ordinal 1.

## Tasks

1. Trace the exact production and code path across acceptance, provider resume,
   selection, transcript finalization, and later-turn planning.
2. Make reconsideration input cumulative, simplify the human-resolution prompt
   rule, and clear only reconsidered provider resume state.
3. Add controller, prompt, persistence/planning, and real-model regressions.
4. Run focused checks, independent candidate review, ReviewGPT, and PR CI.
5. Merge, run the protected Cloudflare production workflow, verify the deployed
   version and smoke checks, then provide a live canary.

## Decisions

- Keep the existing four-second draft window and same-thread reconsideration so
  completed effects remain visible during the replacement decision.
- Clear the native provider thread only after the selected reconsidered result
  is finalized; future turns rebuild from the committed visible transcript.
- Use one direct group-prompt rule: later human messages alone answer, withdraw,
  correct, or replace earlier human requests, and affect only what they address.

## Verification

- Passed focused Vitest cases for the held-group controller, ordinary no-thread
  cleanup, model behavior, and finalizer/planning history reconstruction.
- Passed Assistant Engine typecheck and an authenticated same-thread GPT-5.6
  Sol probe covering both independent requests and a human-owned silent beat.
- Passed exact-head required GitHub checks, including the broad Assistant
  Engine coverage shard that caught and then verified the ordinal-0 cleanup
  preservation fix.
- Passed the final full-patch ReviewGPT correction audit with no qualifying
  finding. The audit confirmed cumulative input, single-owner request-1
  cleanup, preserved quiet-turn continuity, and no new queue, state machine,
  dependency, or durable owner.
- Passed a clean current-base merge-tree proof. The protected Cloudflare
  production workflow and live smoke remain the post-merge execution step.
Completed: 2026-08-25
