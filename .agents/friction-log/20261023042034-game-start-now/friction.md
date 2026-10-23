---
title: 'Game start-now PostgreSQL fixture assumes acceptance always starts tomorrow'
severity: 'minor'
---

## Expected Behavior

The start-now agreement test begins with a game whose first day has not started, regardless of the wall-clock time.

## Current Behavior

The fixture accepts default terms, which now start today during the acceptance window. The start-now proposal is then correctly rejected and the test reads a null pending change.

## Minimal Reproducible Example

Run the game-changes-postgres suite during the America/New_York 03:00–20:00 acceptance window. The start-now agreement case fails before testing agreement.

## Possible Solution

Give that fixture an explicit future start date and assert proposal success. This task applies that focused fixture correction.

## Context

Found while running the required game PostgreSQL suites for a negotiation recovery fix. No production behavior changes are needed for this fixture.
