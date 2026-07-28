# Group chat point of view

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Give Murph a grounded, independent point of view in playful group-chat turns
  without weakening floor ownership, truth, care, privacy, or safety.

## Success criteria

- The group-chat product spec, skill guidance, comedy skill, stable group prompt,
  and skill trigger agree on the new behavior.
- Direct, factual, sensitive, and consequential turns remain plain; unsupported
  facts, random novelty, compulsory agreement, and reflexive contrarianism stay
  disallowed.
- Focused prompt/skill regressions and canonical diff-aware verification pass.
- Product-experience review, the combined prompt/coverage ReviewGPT pass, parent
  final review, PR CI, and mergeability complete with no unresolved accepted
  finding.

## Scope

- In scope: the supplied group-chat point-of-view patch; directly affected
  assistant-engine prompt/skill assets; focused tests; current group-chat owner
  documentation.
- Out of scope: floor-ownership policy, room preference persistence, runtime
  routing, delivery cadence, model selection, and unrelated prompt sections.

## Constraints

- Technical constraints: preserve the stable cacheable group-only prompt layer;
  keep skill loading selective; add no state, service, dependency, or runtime
  branch.
- Product/process constraints: preserve human-first conversation, iMessage
  reciprocity, and the current privacy/safety boundaries; treat the supplied
  patch as intent until local review and proof confirm it.

## Risks and mitigations

1. Risk: the added guidance becomes repetitive or forces novelty.
   Mitigation: keep one compact stable rule plus detailed skill guidance and
   retain explicit straight-answer/reaction/silence exits.
2. Risk: “point of view” encourages invented personal facts or unsafe play.
   Mitigation: ground every move in visible room evidence and retain explicit
   truth, care, privacy, and safety precedence.
3. Risk: overlapping work also edits the shared system prompt.
   Mitigation: stay isolated on the task branch, touch only the group social
   paragraph, and reconcile against current `main` before merge.

## Tasks

1. Apply and inspect the supplied patch against current `main`.
2. Run focused prompt/skill tests, canonical diff-aware verification, and
   direct prompt-layer readback.
3. Complete the product-experience and preliminary prompt/coverage reviews;
   resolve any accepted findings.
4. Run parent final review, close the plan with a scoped commit, update the PR,
   prove CI and mergeability, and merge.

## Decisions

- Treat this as prompt-primary product behavior: run local
  `product-experience-review`, the preliminary prompt and coverage lenses, and
  skip the separate final ReviewGPT gate unless non-prompt scope expands.
- Keep the existing architecture: prompt, skill assets, and owner spec only.

## Verification

- `pnpm exec vitest run --config packages/assistant-engine/vitest.config.ts
  packages/assistant-engine/test/assistant-group-chat-style-skill.test.ts
  packages/assistant-engine/test/assistant-groupchat-comedy-skill.test.ts
  packages/assistant-engine/test/assistant-skill-assets.test.ts
  packages/assistant-engine/test/model-behavior.test.ts --no-coverage`
- `pnpm test:diff packages/assistant-engine
  agent-docs/product-specs/group-chat-social-dynamics.md`
- Direct readback confirms the new point-of-view guidance appears only in the
  group prompt layer and all affected tests pass.
