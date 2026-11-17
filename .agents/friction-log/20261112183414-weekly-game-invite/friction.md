---
title: 'Weekly game invite design-proof spec fails on main for closed-invite states'
severity: 'minor'
---

## Expected Behavior

`apps/web/e2e/pr-weekly-game-invite-design-proof.spec.ts` passes against the current `/screenshots/groups#game-invite` study, so a change to the invite page can extend it.

## Current Behavior

The spec expects "This invite ran out." in the `expired` state and "This link is used up." in `used`, but the study in `apps/web/app/design/game-invite-study.tsx` renders the `used`, `cancelled`, `expired` and `missing` states with a null preview, so each shows "This link isn't available." The spec fails at 390px and 1280px before reaching later assertions. It is not part of required CI, so the drift went unnoticed.

## Possible Solution

Give the study's closed states their real previews (`{ status: "used" }`, `{ status: "expired" }`, `{ status: "expired", reason: "cancelled" }`), or delete the one-off spec.

## Minimal Reproducible Example

VIEWPORT_OVERFLOW_PORT=<free port> pnpm --dir apps/web exec playwright test e2e/pr-weekly-game-invite-design-proof.spec.ts --config playwright.config.ts --project chromium

## Context

Found while adding a wide-screen state to the invite study; the spec could not be extended with a verified assertion, so the new state is covered by the unit test and captured proof instead.
