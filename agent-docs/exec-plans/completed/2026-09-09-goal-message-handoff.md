# Goal messaging handoff

## Outcome

Signed-in visitors can open their assigned Murph conversation from homepage goal cards and the shared composer, with the selected or typed goal prefilled.

## Reaches

Homepage cards, homepage and goal-library composer, and the reused guide contact button. Preserve anonymous native links and desktop signup behavior. Keep private contact resolution authenticated and uncached, with no fallback to a public line on failure. Typed prompts remain in the browser until native handoff.

## Implementation

Reuse the guide contact button for member handoffs. Extend the existing contact route to accept an empty object for contact-only resolution; continue rejecting arbitrary fields and prompts. Preserve canonical guide resolution for existing callers. No database schema or runtime changes.

## Proof

Focused route, rendered component, and interaction tests for member clicks, Enter, anonymous links, Telegram, unavailable routing, repeat clicks, and cancellation. Web typecheck and complexity review. Browser proof with synthetic contacts; actual Messages launch remains an operating-system boundary.

## Progress

- Root cause confirmed in local source and deployed bundle: authenticated goal actions return guide navigation.
- Implementation complete. Existing contact action owns request timeout, repeat-click suppression, navigation cancellation, and retry. No new route-state owner.
- Focused proof: 58 tests across seven files passed; two additional Telegram/timeout cases passed in the nine-case interaction suite afterward (60 total cases). Web typecheck and changed-file ESLint passed.
- Browser proof: the real signed-in production composition rendered at 1440px and 390px on `/design?tab=components#goal-composer`; both captures inspected locally. Temporary capture spec removed. Unrelated catalog controls emitted existing hydration warnings; the changed section rendered correctly.
- Product UX: Ready for the local patch. Click and Enter preserve the draft and open the assigned URI; stale/unavailable routing stays on-page, repeat clicks do not duplicate lookups, and cancelled/timed-out responses cannot launch later. Anonymous links and authenticated Telegram routing retain regression coverage.
- Parent review: authenticated lookup remains private/no-store, accepts only an empty object or one canonical goal identifier, rejects caller-supplied contact/member fields, and performs the existing bounded member/contact reads. No assistant input or message delivery path changes; native app launch is delegated to the operating system.
- Complexity guard passed: six changed source files, no function above 20. Further abstraction is unnecessary.
- Added the member-visible changelog fragment and a public-safe Frog entry for the shared DOM renderer’s missing keyboard compatibility hooks.
- Delivery boundary: local scoped commit only. No PR, production deployment, or external native-app launch was performed; release review and CI remain part of a future shipping step.
Status: completed
Updated: 2026-09-09
Completed: 2026-09-09
