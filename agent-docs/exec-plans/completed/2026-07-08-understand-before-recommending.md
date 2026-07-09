# Understand-Before-Recommending Prompt Primitive

## Goal

Stop Murph from answering personal health improvement questions ("how do I
improve my deep sleep?") with generic ChatGPT-style tip lists. Make
context-grounded discovery a first-class top-level prompt primitive: ground in
vault/wearable evidence first, reflect it back, ask for genuinely missing
context one question at a time across a few messages, capture motivation for
behavior goals, persist what is learned, and close recommendations through the
existing behavior-change setup instead of a one-off list.

Success criteria:

- The static cacheable core prompt contains a new `Understand before
  recommending:` section between product principles and behavior-change
  collaboration.
- The turn priority order recognizes a grounded discovery question as a valid
  complete turn for personal-health recommendation/goal requests.
- `sleep-recovery-readiness` mode 2 supports a bounded multi-turn discovery
  loop when vault/wearable evidence is thin, while keeping its anti-intake and
  anti-checklist rules.
- `behavior-followthrough` captures the user's reason by default for new
  goals (one narrow question), keeping the no-deep-interview constraint.
- Prompt regression tests cover the new section and updated lines.
- Focused assistant-engine tests and `pnpm typecheck` pass.

## Scope

- In: `packages/assistant-engine/src/assistant/system-prompt.ts` (new core
  section + one turn-priority clause),
  `packages/assistant-engine/skills/sleep-recovery-readiness/SKILL.md`,
  `packages/assistant-engine/skills/behavior-followthrough/SKILL.md`,
  matching prompt/skill regression tests under
  `packages/assistant-engine/test/`.
- Out: new workflow engines, intent classifiers, routing machinery, schema or
  persisted-state changes, tool changes, onboarding changes, other skills.

## Constraints

- Our utmost priority is clean, simple, long term maintainable and composable
  architecture with minimal complexity.
- Prose policy only; no new runtime abstractions.
- Match each file's existing style (header-plus-bullets prompt sections,
  skill markdown voice).
- Preserve Product Constitution posture: no interrogation intakes, "leave it
  alone" stays a first-class outcome, questions must be decision-changing,
  one question per message, no data-hoarding framing.
- Keep the one-question-per-message texting rhythm; the change is the
  sequence across turns, not more questions per reply.

## Plan

1. Add `buildAssistantUnderstandBeforeRecommendingText()` to the static core
   prompt after product principles.
2. Add the discovery clause to turn priority item 5.
3. Update sleep-recovery-readiness (low-friction assessment, mode 2, response
   contract) and behavior-followthrough (setup step 3).
4. Update prompt/skill regression tests.
5. Verify with focused assistant-engine tests plus `pnpm typecheck`, review,
   and commit through `scripts/finish-task`.
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
