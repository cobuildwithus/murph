---
title: 'Viewport overflow referral fixture expires with the wall clock'
severity: 'minor'
---

## Expected Behavior

The personal usage-credit screenshot study and its overflow assertions should render the same active referral rows regardless of the date when CI runs.

## Current Behavior

The study fixture uses fixed July and August 2026 referral dates while the product projection filters current referrals against the real clock. After the active row expires, the viewport test cannot find its accessible details control and fails even though the changed patch does not touch that screen.

## Possible Solution

Bind the screenshot study to an explicit fixture clock, or generate its active referral dates from one fixed scenario clock shared by the projection and assertions.

## Minimal Reproducible Example

Run the personal usage-credit owner case in `apps/web/e2e/viewport-overflow.spec.ts` after the fixture referral ending August 3, 2026. The expected current-referral control is absent at both attempts.

## Context

This produced one failure after 79 passing browser cases on a billing-only pull request whose diff does not include the viewport test or personal usage-credit owner UI.
