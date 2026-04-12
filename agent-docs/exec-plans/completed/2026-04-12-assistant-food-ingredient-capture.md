# Assistant food ingredient capture prompt guidance

Status: completed
Created: 2026-04-12
Updated: 2026-04-12

## Goal

- Make the assistant system prompt explicitly tell Murph to work harder on food and supplement captures by identifying ingredients, looking them up when needed, and recording calories plus amounts for future reference.

## Success criteria

- The assistant system prompt contains explicit guidance for food, meal, drink, and supplement inputs.
- The guidance tells the model to infer or verify ingredient lists and amounts before logging when details are missing.
- The guidance tells the model to capture calories when they are available or can be reasonably estimated from a web lookup or label.
- Focused prompt tests cover the new guidance.

## Scope

- In scope: `packages/assistant-engine/src/assistant/system-prompt.ts`, focused prompt tests, coordination docs for this task.
- Out of scope: changing write-command behavior, food parsing pipelines, or broader assistant nutrition workflows.

## Constraints

- Technical constraints:
- Keep the edit narrow because `system-prompt.ts` already has overlapping active lanes.
- Product/process constraints:
- Preserve existing prompt behavior outside this food/supplement capture guidance.
- Follow the package-level verification lane for `packages/assistant-engine`.

## Risks and mitigations

1. Risk: prompt wording becomes too broad and changes unrelated assistant behavior.
   Mitigation: add one focused guidance block inside the existing health reasoning section and cover it with direct tests.

2. Risk: the prompt encourages invented nutrition data.
   Mitigation: require web lookup or label-backed capture when details are unclear, and frame calories/amounts as best-effort rather than fabricated certainty.

## Tasks

1. Update the system prompt with explicit food/supplement ingredient capture guidance.
2. Add focused tests that assert the new prompt instructions are present.
3. Run package-local verification plus final review, then finish the plan with a scoped commit.

## Decisions

- Keep this as a prompt-only behavior change in `assistant-engine`; do not widen into parser or CLI changes.
- Keep the new wording in the health-reasoning section so the change stays user-intent-facing and does not imply new command-surface behavior.

## Verification

- Commands run:
  - `pnpm --dir packages/assistant-engine typecheck`
  - `pnpm --dir packages/assistant-engine test:coverage`
  - `pnpm test:smoke`
  - `pnpm exec tsx --eval "...buildAssistantSystemPrompt(...)"` direct prompt readback
- Outcomes:
  - `typecheck` passed
  - `test:coverage` passed after the focused test update
  - `test:smoke` passed
  - Direct prompt readback printed the new ingredient/calorie/web-lookup guidance
Completed: 2026-04-12
