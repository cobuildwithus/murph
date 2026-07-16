# Murph core strategy and prompt proposal

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Create a compact, canonical strategy for Murph that explains how it helps a
  member pursue meaningful health outcomes through durable context, useful
  action and follow-through, authorized proactivity, connected evidence, and
  delight.

## Success criteria

- A one-page durable strategy document captures the product promise,
  differentiated advantages, operating loop, and guardrails.
- `agent-docs/index.md` identifies the new document and its source-of-truth
  role.
- The canonical product-marketing context carries the new delight strategy so
  later positioning and messaging work does not lose it.
- The live system prompt and recent longitudinal-context change are inspected,
  and a concrete prompt amendment is proposed for discussion without modifying
  runtime prompt behavior in this task.
- The final Markdown diff is read back, reference-checked, privacy-reviewed,
  and committed through the plan-bearing task workflow.

## Scope

- In scope: product-strategy and product-marketing-context documentation, docs
  index maintenance, and read-only analysis of the current system prompt,
  prompt tests, and relevant history.
- Out of scope: editing the live system prompt, changing runtime behavior,
  adding capabilities, or claiming unimplemented music-generation support.

## Constraints

- Technical constraints: preserve current prompt work owned by active isolated
  branches; keep this task Markdown-only.
- Product/process constraints: context must earn a clear benefit; proactivity
  must be useful, authorized, and easy to stop; delight must serve the member
  rather than engagement; health guidance must preserve uncertainty,
  appropriate escalation, autonomy, and ordinary life.

## Risks and mitigations

1. Risk: the strategy becomes a mandate to collect more data or send more
   messages.
   Mitigation: define success as better judgment and outcomes with fewer,
   better-timed interventions, not profile depth or engagement.
2. Risk: "make the member happy" becomes shallow entertainment or conflicts
   with health, truth, and safety.
   Mitigation: define delight as warm, creative, person-specific usefulness
   bounded by honesty, consent, life fit, and the member's real interests.
3. Risk: prompt advice drifts from implemented capabilities or overlaps active
   prompt branches.
   Mitigation: separate implemented facts from target state and leave the live
   prompt unchanged until the wording and integration lane are reviewed.

## Tasks

1. Reconcile the vision with canonical product, marketing, onboarding,
   experiment, habitat, and prompt evidence.
2. Draft and index the one-page strategy document.
3. Carry the delight strategy into the canonical product-marketing context.
4. Produce an exact system-prompt amendment proposal with tradeoffs and
   capability boundaries.
5. Read back and reference-check the Markdown-only diff, inspect it for private
   identifiers, and close the plan through `scripts/finish-task`.

## Decisions

- This task lands strategy first and does not edit the live system prompt.
- The canonical repository marketing context remains under `agent-docs/` per
  repo policy; it is not moved to a skill-default location.
- The strategy treats health aspirations, problems, understanding, and
  protection as equally valid starting points so Murph does not manufacture a
  deficit for a member who feels well.
- “10× easier” and “tens of thousands of data points” remain internal ambition
  and possible depth, not measured claims, collection targets, or onboarding
  quotas.
- Delight is a product outcome and part of care. It is bounded by truth,
  safety, privacy, member preference, route capability, useful silence, and
  the rule that novelty cannot rescue a broken support loop.
- The current prompt already implements most of the longitudinal-context and
  follow-through strategy. Its direct static core is at the 7,500-character
  budget, so a future prompt task should compress and revise existing identity,
  context-discovery, and capability guidance instead of appending another
  strategy block. It should also add an explicit purpose/eligibility gate to
  proactive image generation because vault-backed generated images are durable
  captures.

## Verification

- Commands to run: direct Markdown readback, targeted `rg` reference checks,
  `pnpm docs:drift`, and final `git diff --check` plus scoped diff inspection.
- Expected outcomes: the new strategy is indexed, internally consistent with
  current product rules, contains no private identifiers, and the docs drift
  check passes.
- Result: `pnpm docs:drift`, reference, whitespace, privacy, and scoped-diff
  checks passed on 2026-07-15. The unrelated operator-config test edit remained
  outside this task's scope.
Completed: 2026-07-15
