# Journal date navigation and recovery

Status: completed
Created: 2026-09-06
Updated: 2026-09-06

## Outcome and protected boundary

Keep Today aligned with the browser local date, label historical statistics
accurately, and show background refresh progress for empty timelines. Make calendar
selection perceivable and comfortable on touch screens. Journal remains a
read-only view of canonical Browser Vault records; no data or capture changes.

## Evidence and implementation

The component initializes its selected date from a server UTC snapshot and never
updates that state when the clock changes. Statistics always say Last 7 days,
even for history. The refresh indicator is gated on a nonempty days collection.
Calendar day buttons are 30 pixels tall and expose no selected state.
Derive Today from the existing clock until a historical date is explicitly
selected. Reuse existing controls and dates; add no dependency or persistence.

## Product UX

- Entry: Journal, existing seven-day timeline and calendar.
- Reaches: local/UTC date differences, midnight rollover, historical navigation,
  empty refreshing accounts, phone touch and desktop keyboard users.
- Proof: focused component regressions and rendered production components in
  the synthetic design study at phone and desktop sizes.
- Done when: Today follows local time while history stays put, statistics name
  their displayed dates, empty refresh remains visible, and calendar selection
  is visible and exposed to assistive technology.
- Exclusions: capture, editing, auth, queries, live member data and deployment.

## Verification and completion

- Reproduce clock and empty-refresh failures before implementation.
- Run focused dashboard tests, Web typecheck, changed-file lint and complexity.
- Inspect rendered phone and desktop states, then review full diff and privacy.
- Update Journal owner and changelog; close this plan and create a scoped commit.
- Final external review is not routed for this frontend-only interaction patch.

## Results

Product UX: Ready.

- Reproduced the stale selected day and missing calendar selected state before
  the fix. Added a server-render/hydrate regression with different UTC/local
  dates; it switches to the local date without a recoverable hydration error.
- Dashboard regressions: 39 passed. Journal navigation regressions: 4 passed.
  Changelog fragment checks: 7 passed.
- Web typecheck and changed-file ESLint passed. Complexity diff passed with
  no hotspots above 20 and unchanged maximum source complexity of 18.
- Playwright passed with production Journal components and synthetic study
  data at 320, 390 and 1280 pixels. Checked keyboard selection, mobile drawer,
  selected-period statistics, Today recovery, refresh status and overflow.
- Inspected native-resolution phone/calendar/desktop screenshots under ignored
  local artifacts. Updated the existing study with page padding, a named ready
  state and an empty refreshing state. Synthetic study controls remain inert.
- Source diff, data ownership and privacy reviewed. No dependencies, persistence,
  server behavior, assistant behavior or production settings changed.
- Browser study emits an unrelated component-catalog hydration warning from
  input caret styling during capture; Journal interactions and assertions pass.
- Local scoped commit only. No PR, remote CI, merge or deployment performed.

Completed: 2026-09-06
