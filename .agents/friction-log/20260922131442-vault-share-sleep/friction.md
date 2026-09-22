---
title: 'Vault-share sleep delivery fixture expires against the real calendar'
severity: 'minor'
---

## Expected Behavior

The source-recorded timestamp test should exercise the same delivery regardless of the day CI runs.

## Current Behavior

The fixture uses fixed July dates but the route applies retention using the real clock. Once those dates age out, the route correctly delivers an empty set and the timestamp assertion fails.

## Possible Solution

Freeze Date for this test and restore it afterward. Preserve production retention behavior.

## Minimal Reproducible Example

Run the vault-share deliver route timestamp case with a system date more than the retention window after its fixed source records. Compare with a date immediately after those records.

## Context

Found during checkpoint PR verification in an unchanged Web test. The fixture clock is the only required correction.
