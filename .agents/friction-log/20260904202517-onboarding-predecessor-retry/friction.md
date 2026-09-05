---
title: 'Onboarding predecessor retry assertion fails for a zero-jitter schedule'
severity: 'minor'
---

## Expected Behavior

The onboarding predecessor regression test should accept the preserved pending retry when a migrated daily schedule matches the legacy occurrence time.

## Current Behavior

The original legacy predecessor case can generate a daily schedule with zero jitter. Its assertion recognizes the preserved pending occurrence but then unconditionally expects the next daily run, failing assistant-engine coverage and the required release gate.

## Possible Solution

Reuse the test's existing transfersLegacyPendingOccurrence condition when choosing the expected next run. No scheduling implementation change is needed.

## Minimal Reproducible Example

Run the predecessor terminally stale cases in packages/assistant-engine/test/assistant-outbox-runtime.test.ts with a synthetic vault whose generated onboarding slot is 13:30. The pending retry is due at 13:31:30 on the same day, while the old assertion expects the following day's daily occurrence.

## Context

An unrelated runtime restore patch exposed this existing generated-fixture assertion failure during its final release checks. The correction is confined to test evidence.
