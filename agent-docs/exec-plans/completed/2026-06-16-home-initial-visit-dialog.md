# Home Initial Visit Dialog

## Goal

Show a first-visit welcome dialog on `/home?initialVisit=true` that pushes newly
signed-up users toward messaging Murph, while leaving a clear secondary path to
explore the home page.

Success criteria:

- Homepage signup routes authenticated users to `/home?initialVisit=true`.
- `/home` opens a welcome dialog only for the `initialVisit=true` query.
- Primary CTA routes to the existing Murph chat/contact flow.
- Secondary CTA dismisses the dialog without blocking page exploration.
- Implementation reuses existing dialog/button patterns and avoids new
  persisted state or broad onboarding abstractions.

## Scope

- `apps/web` onboarding/home UI and focused tests.
- No auth/session authority changes, payment changes, or persisted state.

## Coordination

- Avoid unrelated active hosted usage-limit notice changes.
- Work carefully around existing uncommitted hosted onboarding and chat-dialog
  edits in the checkout.

## Verification Plan

- Focused hosted onboarding/home tests.
- `pnpm --dir apps/web verify` or the required repo app lane if scoped checks are
  insufficient.
- Desktop and mobile browser verification for `/home?initialVisit=true`.

## Status

- 2026-06-16: Implemented landing auth redirect to `/home?initialVisit=true`,
  home welcome dialog, focused tests, and small durable docs notes. Focused
  Vitest suite passed once; rerunning after cleanup before broader verification.
- 2026-06-16: Replaced the generic AI/sparkle icon with the Murph SVG mark,
  tightened the welcome subtext, kept the primary CTA visibly `Text Murph`, and
  split signup/login completion routing so login lands on ordinary `/home`.
  Focused Vitest passed, `pnpm --dir apps/web verify` passed, and rebuilt
  desktop/mobile browser checks passed for `/home?initialVisit=true`.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
