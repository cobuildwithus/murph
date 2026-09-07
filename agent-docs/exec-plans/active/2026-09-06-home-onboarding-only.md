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
- Implementation and focused verification in progress.
