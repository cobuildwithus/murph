# Clarify onboarding goals and preserve their meaning

Status: active
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Make the early aspiration and wearable questions easy to answer by offering
  a few concrete examples in natural language.
- Preserve each goal's user-stated success picture and motivation durably in
  the existing canonical vault owners.
- Offer the existing Apple Health handoff as a low-effort step-count starting
  point when a member has no wearable and uses an iPhone.

## Success criteria

- The success clarifier explains the kind of answer Murph needs with examples
  tied to the member's stated goal, without turning into a scripted intake.
- Each concrete goal remains a canonical goal record; confirmed success and
  motivation context that the goal schema cannot represent is saved once in
  canonical Context memory, in the member's words and associated with the
  named goal or goals.
- The data-source question names a short representative set of supported
  sources, and the no-source iPhone branch offers the canonical Apple Health
  App Store handoff without claiming permission or sync before it exists.
- Focused prompt-asset tests, diff-aware verification, product review,
  preliminary prompt/coverage ReviewGPT, CI, and clean mergeability pass for
  the exact PR head.

## Scope

- `packages/assistant-engine/skills/murph-onboarding/SKILL.md`
- Focused assistant-engine prompt/skill regression tests.
- `agent-docs/product-specs/murph-onboarding.md` for the durable product and
  persistence contract.

## Constraints

- Keep the existing onboarding lifecycle, goal owner, Context memory owner,
  device tool, and canonical App Store handoff; add no state, schema, tool,
  service, or automation.
- Do not infer a motivation, success criterion, device, HealthKit permission,
  or completed sync.
- Preserve the immediate-need rule, clarification budget, one-question-per-
  message pacing, and iMessage link/deliverability rules.
- Coordinate around existing non-exclusive onboarding-skill lanes and resolve
  only overlapping prompt text needed by this task.

## Tasks

1. Trace the current prompt, canonical goal and memory owners, Apple Health
   handoff, and focused regression seams.
2. Tighten the onboarding skill and product spec at their existing owner
   boundaries.
3. Add focused regressions for example-backed questions, durable why/how
   persistence, and the truthful iPhone Apple Health offer.
4. Run required verification and product/prompt/coverage review.
5. Commit, push, open the PR, resolve findings, and prove CI plus mergeability.

## Evidence

- The current success clarifier is the abstract question "What would success
  look or feel like?", which produced a confused member response in a live
  onboarding conversation.
- The current skill saves concrete aspirations as goals but does not explicitly
  route the goal schema's missing success and motivation fields into Context
  memory.
- The stable system prompt already owns the canonical Apple Health App Store
  URL and states that the iOS app can connect Apple Health; the onboarding
  skill does not yet offer that path after a no-source answer.
