---
title: 'Journal calendar live proof expects a check-in before the promised delay'
severity: 'minor'
---

## Expected Behavior

The calendar capture journey should assert a check-in one hour after the synthetic event ends, comparing the actual scheduled instant.

## Current Behavior

The fixture event ends at 19:00 in Europe/Warsaw. The assertion accepts 19:00 or 17:00 in serialized schedule text, which describes the event end instead of the required hour-later check-in. A correct 18:00 UTC schedule fails the paid journey. Its mocked occurrence projection repeats the same stale expectation.

## Possible Solution

Compare the scheduled instant to event end plus one hour and align the fixture occurrence projection. Keep the single-write and privacy assertions.

## Minimal Reproducible Example

Run the focused `real Codex Journal connected calendar capture e2e` journey with Luna. A returned schedule of `2026-08-31T18:00:00.000Z` fails the old `/19:00|17:00/` assertion despite being one hour after the fixture event end.

## Context

Found during background-model routing verification. The owning production instruction already requires one hour after the event; the correction is isolated proof, not a timing-policy change.
