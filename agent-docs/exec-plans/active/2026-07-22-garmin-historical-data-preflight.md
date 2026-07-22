# Add the Garmin historical-data preflight

Status: active
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Remind members to enable Garmin's default-off Historical Data permission
  before Murph sends them into the Garmin connection flow.
- Keep the reminder visible in the live component reference at
  `/design?tab=components`.

## Success criteria

- A new Garmin connection opens a focused preflight dialog before any connect
  request or external redirect.
- Continuing preserves device-connect intent claims and legal-consent retries
  without showing the Garmin reminder twice in one attempt.
- Non-Garmin connections and Garmin reconnect behavior remain unchanged.
- Focused tests, desktop and phone UI proof, required review, CI, and
  ReviewGPT pass for the exact PR head.

## Scope

- The hosted Web connect-page client and connect dialogs.
- The `/design` components tab.
- Focused connect-page tests and current product documentation if required by
  the final implementation.

## Constraints

- Do not claim that Murph can inspect or enforce Garmin's permission toggle.
- Do not change Junction configuration, provider authorization, or historical
  backfill ownership.
- Reuse the current Base UI dialog and semantic design tokens.

## Tasks

1. Add a reusable Garmin historical-data preflight dialog.
2. Gate manual and device-intent Garmin starts before the authorization call.
3. Add the dialog to the live design-page components reference.
4. Cover the state sequence and non-Garmin behavior with focused tests.
5. Complete responsive browser proof, verification, review, and PR gates.

## Evidence

- Garmin presents Historical Data as a separate permission and leaves it off
  by default in the external authorization screen.
- The current connect-page client requests a Garmin authorization URL and
  redirects immediately, so the Web connect owner is the smallest truthful
  boundary for a preflight reminder.
- Focused connect-page coverage passes with 77 tests, including manual Garmin
  starts and device-intent plus legal-consent continuity.
- `pnpm test:diff` passes the affected Web verification lane: 490 test files,
  6,140 tests, lint with pre-existing warnings only, dev smoke, typecheck, and
  production build.
- The required product-experience remediation review returned `NO FINDINGS`.
- Standalone Playwright rendered the production dialog from the Components
  design page at 1440x1000 and 390x844. The mobile pass caught and corrected a
  max-width override so the shared 16px dialog gutter remains intact.
- The Claude UI double-check remains unavailable because Fable reported
  explicit credit exhaustion.
