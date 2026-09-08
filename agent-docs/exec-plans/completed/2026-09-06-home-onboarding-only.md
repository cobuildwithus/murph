# Home onboarding only

## Outcome and scope

Home shows remaining messaging, device, and lab setup cards. Once no cards remain,
it shows a quiet Text Murph prompt. Remove experiment runs, experiment suggestions,
and feature promotions from Home. Preserve authentication, initial personality
onboarding, connection callbacks, usage notices, and data-load recovery.

## Product UX

- Effort: Product change.
- Entry and promise: Open /home to finish setup or continue the conversation.
- People: New members, partially connected members, members with completed setup
  and active or historical experiments, and members with unavailable vault data.
- Proof: Focused page and browser-vault component tests; desktop and phone render
  of the production onboarding and empty state in the existing study.
- Done when: No experiments render on Home; setup and errors remain truthful;
  completed setup shows Text Murph without a new state owner.

## Progress

- Confirmed experiment rendering and promotion originate in Home composition.
- Removed Home experiment rendering, the experiment setup suggestion, and feature
  promotions. Existing onboarding filters now render Text Murph when empty.
- Product UX: Ready. Synthetic query-client tests cover active, planned, paused,
  completed, and stopped experiments; remaining setup; completed data setup;
  pending first message; loading; and unavailable vault data.
- Focused proof: 65 tests passed across Home, browser-vault onboarding, retained
  experiment cards, and changelog rendering. Final changed page/component rerun:
  48 passed. Web typecheck passed. Full Web lint: no errors, existing warnings.
- Chromium study proof passed at 390px and 1440px. Inspected the real components,
  wrapping, heading semantics, and overflow; temporary capture spec removed.
- Complexity guard passed; HomePage's existing complexity 28 is unchanged.
- No new state, dependencies, external effects, or deploy contract. Parent review
  found no remaining implementation issues. Final ReviewGPT is not required for
  frontend-only presentation. PR #3017 carries required CI and Web delivery.
- The first direct Vitest invocation ran before generated catalog preparation;
  rerunning through the documented Web test entrypoint passed all 65 tests.
Status: completed
Updated: 2026-09-07
Completed: 2026-09-07
