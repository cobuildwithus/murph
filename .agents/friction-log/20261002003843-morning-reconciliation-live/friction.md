---
title: 'Morning reconciliation live fixture rejects a supported automation patch field'
severity: 'minor'
issue: 'cobuildwithus/murph#3989'
---

## Expected Behavior

The synthetic morning reconciliation port accepts and forwards the production automation patch contract, including plannedOccurrenceOffsetMs when preserving an explicit event-relative reminder offset.

## Current Behavior

The fixture's manually maintained field allowlist and patch forwarding omit plannedOccurrenceOffsetMs. A valid reschedule request fails inside the fake port before reaching the canonical writer. The model then explores recovery and may repeat inventory reads, obscuring whether the production behavior actually regressed.

## Minimal Reproducible Example

In the morning reminder reconciliation journey, submit a versioned schedule patch for the linked pool reminder with plannedOccurrenceOffsetMs set to 3600000. The production tool schema accepts this field, but the previous fixture adapter rejects it. This task updates the adapter and asserts the canonical one-hour offset alongside the exact due instant.

## Context

The mismatch consumed repeated live verification runs. Synthetic adapters should preserve supported production fields and assert their actual canonical effects rather than implement a narrower parallel command contract.
