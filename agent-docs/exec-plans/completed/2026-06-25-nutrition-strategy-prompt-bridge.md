# Nutrition strategy prompt bridge

## Goal

Update the Murph assistant prompt so the new `nutrition-strategy` skill is
called out explicitly alongside the existing assistant-engine Murph skills.
Success means forward-looking nutrition advice routes to the skill, meal
capture remains owned by `food-journal`, tests cover the bridge, and the PR
branch is rebased and pushed.

## Scope

- In: assistant-engine prompt guidance, nutrition skill tests, scoped
  verification.
- Out: new nutrition stores, CLI surfaces, `.agents` skills, or broader prompt
  rewrites.

## Constraints

- Keep the skill in the package-owned Murph assistant skill tree beside
  `experiment-onboarding`.
- Preserve the existing compact skill-file route list.
- Prefer a concise outcome-first prompt bridge.

## Steps

1. Add the explicit system-prompt bridge for forward-looking nutrition work.
2. Update focused tests for the prompt bridge and skill placement.
3. Run focused verification and privacy checks.
4. Close the plan with a scoped commit and push the PR branch.
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
