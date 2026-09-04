# Goal Help Routing

## Outcome

Route explicit requests for help pursuing an achievable health outcome through
the existing `goal-setup` owner before broad domain guidance, so public Goal
CTAs resolve their exact Health Commons Goal record when one exists.

## Protected invariants

- Informational health questions remain owned by their domain skill and do not
  manufacture a Goal.
- A bare Goal CTA authorizes read-only grounding and one useful question, not
  saved state or outbound support.
- Health Commons Goal resolution remains owned by `goal-setup`; no second
  router, tool, or state owner is introduced.
- Internal implementation names, keys, and revisions remain out of the reply.

## Current owner and evidence

- `buildAssistantSkillRouteHintText` owns the top-level skill-routing hint.
- `goal-setup/SKILL.md` already owns exact public Goal list/show resolution.
- The exact public sleep-continuity outcome exists in the generated Goal
  catalog, while recent production behavior did not complete list plus show.

## Product UX classification

Product UX Patch: correct an existing conversational route without adding a
new surface or interaction. Replay an exact public Goal CTA, a plain-language
equivalent outcome request, and a knowledge-only sleep question.

## Smallest correction

Clarify one existing setup-router line so concrete requests to pursue an
achievable health outcome—including natural “help me” phrasing—load
`goal-setup` before domain or broad knowledge routing. Keep the detailed exact
lookup policy in `goal-setup`.

## Proof

1. Add deterministic prompt-composition coverage for the route and its
   knowledge-only boundary.
2. Add a focused production-derived real-Codex journey for the public sleep
   Goal CTA, asserting successful Goal list/show before the first question,
   no mutation, and no internal terminology.
3. Run the live journey against the pre-fix prompt to attempt direct
   reproduction, then rerun after the prompt correction.
4. Run the focused unit tests, assistant-engine typecheck, and final diff/privacy
   inspection.

## Observed evidence

- The pre-change live sample happened to resolve the exact public Goal, so the
  production miss is stochastic rather than a deterministic local failure.
- The first post-change sample resolved the exact Goal but exposed an unrelated
  over-broad assertion for a secondary readiness owner; the focused regression
  now stays on the missing route and exact Goal resolution while the existing
  full setup journey continues to cover registered-owner reads.
- The final post-change live sample read `goal-setup`, listed and showed the
  exact sleep-continuity Goal, checked private Goal state and compact memory,
  made no writes, and asked one question only after grounding.
- Focused prompt tests, the assistant-engine typecheck, and the complexity
  ratchet pass. The stable route prompt is smaller than its prior bound.

## Delivery

Commit the scoped prompt, deterministic test, live journey, and completed plan;
open a draft PR, start ReviewGPT only if the final scope triggers it, and use
exact-head CI as the merge gate. Deployment remains a separate authorization
boundary.
