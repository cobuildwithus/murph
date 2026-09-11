---
title: 'WHOOP headed smoke expects obsolete content-free diagnostic'
severity: 'minor'
---

## Expected Behavior

The headed consent smoke should accept fixed diagnostic categories while rejecting provider page content and raw hostnames.

## Current Behavior

The WHOOP timeout case still expects the former bare timeout message. The runner now correctly includes an allowlisted action and before/after location categories, so the opt-in browser lane fails before viewport checks.

## Minimal Reproducible Example

Enable MURPH_E2E_HEADED_BROWSER_SMOKE=1 and run apps/web/test/hosted-headed-browser-smoke.test.ts with the Web Vitest workspace. The synthetic WHOOP overlay blocks GRANT, producing the safe timeout diagnostic that the old exact assertion rejects.

## Possible Solution

Update the exact expected diagnostic to the fixed WHOOP action and location categories. Preserve the existing synthetic-content and raw-host exclusion assertions.

## Context

The assertion is skipped in ordinary Web unit runs and executed by the optional viewport lane.
