---
title: 'Live journey selection rejects workspace-prefixed pnpm engine warnings'
severity: 'minor'
issue: 'cobuildwithus/murph#4882'
---

## Expected Behavior

The focused live runner accepts a valid Vitest test inventory preceded by known pnpm engine warnings, while continuing to reject arbitrary output and ambiguous selections.

## Current Behavior

A pnpm child invocation prefixes engine warnings with a workspace path and a pipe separator. The inventory parser accepts an unprefixed warning but rejects this supported prefix, so an otherwise valid single test cannot start.

## Minimal Reproducible Example

Pass a synthetic line `../.. | WARN Unsupported engine: synthetic` followed by a JSON array containing one named test to `requireSingleAssistantRealCodexTest`. It throws the unreadable-list error before any provider call.

## Context

This blocked a focused fixture investigation. A synthetic unit regression reproduces the parser failure without credentials or provider work.
