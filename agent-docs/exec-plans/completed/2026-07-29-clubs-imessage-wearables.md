# Clubs iMessage and wearables

## Outcome

Make `/clubs` plainly communicate that Murph runs club challenges through
iMessage, accepts members using different connected wearables, and keeps
supported challenge scoring current without organizer spreadsheets.

## Scope

- Reuse the existing production phone mock for the hero, organizer, and private
  member conversations.
- Keep the hero challenge result inside the message sequence rather than above
  the conversation.
- Add a wearable section using existing connected-source assets and an honest,
  grouped inventory of supported challenge inputs.
- Remove the tentative “Illustrative early-access flow” label.
- Update the existing Clubs design study and focused Web tests.

## Invariants

- This remains synthetic marketing presentation only. It adds no enrollment,
  device-sync, challenge, messaging, database, or permission behavior.
- Product copy must distinguish supported connected sources from a claim that
  every device or metric is universally available.
- Challenge sharing remains explicit and scoped. Private conversations, routes,
  and unrelated health context remain private.
- The production component remains the source for the `/design?tab=sections`
  study.

## Steps

1. Confirm the current phone, homepage integration, and challenge-metric owners.
2. Implement the shared phone presentation, iMessage copy, wearable section,
   and in-chat result order.
3. Update focused tests and render desktop and mobile design-study proof.
4. Run canonical verification and required frontend/product reviews.
5. Commit, push, open a PR, resolve required gates, and verify the deployed page.

## Evidence

- Focused Clubs and shared-phone tests passed, including direct default/after
  result ordering and decorative-composer semantics.
- `pnpm test:frontend-design-proof` passed, as did the exact PR-body/catalog
  checker and the 320/375/390/768/1280 overflow scenarios.
- `pnpm test:diff ...` passed with the full Web test, typecheck, lint, dev-smoke,
  and production-build lane; `pnpm verify:acceptance` passed.
- Desktop and mobile screenshots from the Clubs design study were uploaded and
  linked in PR #1105.
- Product-experience review's supported-source qualifier finding was resolved.
  Preliminary ReviewGPT's keyboard-focus and ordering-coverage findings were
  resolved; its test-only patch was inspected before application. Parent final
  review found no unresolved product or implementation issue.
- The Claude UI check was attempted with Fable but could not run because the
  account reported explicit usage-credit exhaustion.
- The separate final ReviewGPT gate is exempt because this is static marketing
  content/presentation with no workflow, state, data, authority, or
  product-critical-flow change.
Status: completed
Updated: 2026-07-29
Completed: 2026-07-29
