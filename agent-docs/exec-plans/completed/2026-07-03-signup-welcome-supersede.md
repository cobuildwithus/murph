# Supersede the canned signup welcome once conversation has started

## Problem

When a hosted member verifies their number and texts before the queued signup
welcome dispatches (~12s cold-start window), the runtime's conversation lane
starves the system-lane welcome item. The welcome then lands minutes later,
out of order, after the assistant has already onboarded the user organically
(incident debugged 2026-07-03: welcome delivered 9
minutes after activation, mid-conversation; see
`agent-docs/exec-plans/active/2026-07-03-mailbox-wake-collapse.md` for the
adjacent latency work).

Root cause of the redundant send: the canned welcome's implicit validity
condition — "this is the user's first contact" — is only recorded when the
delivered reply text is exactly `ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE`
(`packages/assistant-engine/src/assistant/delivery-service.ts`), so an organic
onboarding reply never marks first contact, and the existing first-contact
skip in `notification-turn.ts` cannot fire for the queued welcome.

## Change

1. `packages/assistant-engine/src/assistant/delivery-service.ts` — mark
   first contact seen when any non-empty conversation reply with onboarding
   guidance injected reaches an accepted delivery outcome, instead of only the
   exact canned welcome text. No new state; per-route doc scoping unchanged.
2. `packages/assistant-runtime/src/hosted-runtime/events/assistant-notification.ts`
   — when the signup-welcome notification is superseded by prior first
   contact (skip decision), still seed the self-archiving onboarding
   follow-up automation (product-critical flow preservation), and log the
   notification decision kind so skips are observable.
3. Matching engine + runtime tests proving: welcome still sends for a silent
   signup; welcome skips after an organic onboarding reply on the same route;
   follow-up automation is seeded on both paths.

## Invariants

- Welcome delivery stays intact for members who have not received any
  assistant reply on the welcome route (Product-Critical Flow Preservation).
- No new persisted state, queues, or wake machinery; reuse the existing
  first-contact marker and notification-turn skip.
- The supersede is per-route: conversation on a different channel/route does
  not suppress the welcome.
Status: completed
Updated: 2026-07-03
Completed: 2026-07-03
