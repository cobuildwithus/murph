---
title: 'Video analysis fixtures expire against the real calendar'
severity: 'minor'
---

## Expected Behavior

Video analysis tests should exercise accepted attachments, provider outcomes, and authority boundaries independently of the current calendar date.

## Current Behavior

The video tool fixture uses a fixed August timestamp while authority snapshots and execution enforce the real thirty-day retention boundary. Once that timestamp expires, twenty-five cases fail before their intended assertions, including the timeout case waiting for provider admission that never happens. Required assistant-engine coverage fails for an unrelated change.

## Possible Solution

Pin the test Date.now clock within fixture retention and restore it after each test. Keep real timers except in the existing provider-timeout case, where the fake clock must use the same fixture date. Preserve the separate explicit attachment-expiry tests and production retention behavior.

## Minimal Reproducible Example

Run packages/assistant-engine/test/assistant-codex-analyze-video-tool.test.ts with the wall clock at least thirty days after its fixed receivedAt timestamp. Observe that accepted-video assertions instead return missing or unavailable attachment results.

## Context

The complete affected test file fails in package coverage and the same failure reproduces locally. Only synthetic fixture timing needs correction.
