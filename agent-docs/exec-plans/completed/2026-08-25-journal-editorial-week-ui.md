# Journal editorial week UI

Status: completed
Created: 2026-08-25
Updated: 2026-08-25

## Goal

Bring the approved Paper editorial-week layout into the production Journal
without changing its data sources or grouping rules.

## Success criteria

- The production Journal matches the approved editorial hierarchy on desktop.
- The same content remains clear and usable on narrow screens.
- Week navigation, calendar selection, source hints, empty weeks, and Pattern
  links keep their current behavior.
- The design catalog renders the real production component with synthetic data.
- Focused tests, typecheck, interface checks, and browser proof pass.

## Scope

- Journal header, week summary, day groups, event rows, calendar, Pattern card,
  and private-chat help text.
- Responsive layout and accessible interaction states.
- Journal design-study proof and focused UI tests when needed.

## Constraints

- Keep the existing Journal query projection and Patterns report as the data
  owners.
- Add no dependency, UI kit, icon set, or new state owner.
- Keep provider sources hidden visually and available as accessible metadata.
- Do not add direct editing controls. Corrections continue through Murph chat.

## Tasks

1. [x] Translate the approved Paper layout into the production component.
2. [x] Preserve responsive, empty, navigation, and accessibility behavior.
3. [x] Refresh the design study and focused tests where required.
4. [x] Run focused verification and browser proof.
5. [x] Commit the finished UI and archive this plan.

## Verification log

- Paper exports confirm the approved 1440 px layout, typography, spacing,
  compact event rows, and 342 px context rail.
- The focused Web suite passes with 25 tests, and the prepared Web typecheck
  passes.
- Impeccable reports no interface-pattern findings.
- Desktop and 390 px browser proof confirm the editorial layout. An axe-core
  audit of the interactive design study reports zero violations.
- The local hosted stack exposed a pre-existing non-interactive Cloudflare
  account-selection failure. The documented frontend-only lane provided Web
  backend and browser proof on the required local domain. Frog records the
  repository friction.
Completed: 2026-08-25
