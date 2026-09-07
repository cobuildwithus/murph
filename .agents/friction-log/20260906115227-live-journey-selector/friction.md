---
title: 'Live journey selector rejects full names truncated by Vitest it.each'
severity: 'minor'
issue: 'cobuildwithus/murph#2991'
---

## Expected Behavior

The focused assistant live wrapper accepts the complete unique test name advertised by the test source.

## Current Behavior

Vitest list renders a long it.each $testName using an ellipsis. The wrapper compares the caller pattern to that abbreviated name and reports no matching live journey. A short unique prefix selects and successfully runs the journey.

## Minimal Reproducible Example

Define an it.each row with testName "finds and analyzes a retained video without earlier conversation text" and title "$testName". Run pnpm test:assistant:live -- --test with that complete title. It fails before provider action; the shorter pattern "finds and analyzes a retained video" succeeds.

## Context

This obscures focused opt-in verification and encourages unnecessary debugging of working scenarios. Selection should use an untruncated identifier or document the prefix constraint.
