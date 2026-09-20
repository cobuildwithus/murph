---
title: 'Video analysis test fixtures expire with the wall clock'
severity: 'minor'
---

## Expected Behavior

Retained-video tests exercise provider success, failures, and authorization regardless of the date CI runs.

## Current Behavior

The suite uses media received on 2026-08-20 without freezing Date. After the 30-day retention window, 25 tests fail at media admission before reaching their intended assertions.

## Minimal Reproducible Example

After 2026-09-19, run `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-analyze-video-tool.test.ts` on the unfixed suite.

## Possible Solution

Freeze Date to the fixture day while leaving provider timers real. The existing explicit retirement case should continue denying access.

## Context

This unrelated calendar-dependent failure blocked transport-change CI. Fixed in the same task with test-only clock setup; production retention remains unchanged.
