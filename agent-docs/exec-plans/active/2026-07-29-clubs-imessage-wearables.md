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

- Focused Clubs component/page tests.
- `pnpm test:frontend-design-proof`.
- Canonical Web verification selected by the verification matrix.
- Desktop and mobile screenshots from the Clubs design study.
- Required product-experience, preliminary specialist, parent, and Claude UI
  review evidence.
