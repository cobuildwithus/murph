---
title: 'Browser training canonical-date test depends on the wall clock'
severity: 'minor'
---

## Expected Behavior

The canonical local-date week-bucket test should pass on every calendar date
and host timezone by supplying a fixed current instant and timezone to the
training selector.

## Current Behavior

The fixture uses fixed August 2026 workout data but calls the selector without
its existing `now` and `timeZone` options. The selector therefore defaults to
the real wall clock. Once the current week advances, the expected previous-week
bucket no longer contains the fixture and the app-verification suite fails.

## Possible Solution

Pass a fixed August 10, 2026 `now` value and an explicit timezone to the
selector in this test, matching the pattern already used by nearby
week-boundary coverage.

## Minimal Reproducible Example

```sh
TZ=UTC pnpm exec tsx apps/web/scripts/run-hosted-web-vitest.mts \
  apps/web/test/browser-training-view.test.ts \
  -t "Training uses the canonical local date for week buckets and progress labels"
```

The assertion for the previous week's count expects one and receives zero.

## Context

A developer-tooling PR with no `apps/web` diff passed every other required
check but could not obtain a green app-verification job because this
calendar-sensitive test now fails on both the PR head and the identical
`origin/main` test blob.
