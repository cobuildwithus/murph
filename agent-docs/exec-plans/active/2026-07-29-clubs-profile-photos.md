# Clubs marketing-page refinements

## Outcome

Refine the `/clubs` marketing page so the head-to-head leaderboard feels human,
the iMessage phone mockups read like real phones, the idea-to-challenge copy
starts directly with Murph's value, and the wearable story has a clear visual
hierarchy.

## Scope

- Reuse the existing Murph persona portraits for the three leaderboard rows.
- Narrow the Clubs-only phone wrappers without changing the shared phone mock
  used by the homepage or other surfaces.
- Remove “Start in plain language.” from the idea-to-challenge section.
- Split the wearable sources and automatically tracked inputs into two distinct,
  more readable visual chapters.
- Replace the dense metric table with an icon-led, color-coded metric map and
  keep every supported challenge input visible.
- Set the Clubs-only phone wrappers to a balanced width between the original
  and the first narrow revision.
- Percent-encode the challenge email subject and body so mail clients render
  spaces and prompts correctly instead of exposing form-encoding characters.
- Replace the pre-launch language with live-launch positioning and direct
  “Start a challenge” calls to action.
- Add the launch pricing truth to the FAQ: usage-only organizer billing with no
  platform fee, two free member weeks, then the eligible $3.50 monthly Group
  plan.
- Update the existing Clubs design study and focused Web tests.

## Invariants

- This remains synthetic marketing presentation only. It adds no challenge,
  messaging, enrollment, database, device-sync, or permission behavior.
- Existing on-brand persona assets remain decorative beside visible names.
- Shared phone behavior and non-Clubs consumers remain unchanged.
- The production component remains the source for the design study.

## Steps

1. Implement the profile-photo, copy, phone-width, and wearable hierarchy
   refinements.
2. Update focused tests and render desktop/mobile design-study proof.
3. Run scoped verification and required frontend/product review.
4. Commit, push, open a PR, resolve gates, and verify the deployed page.

## Evidence

Pending.

Status: active
Updated: 2026-07-29
