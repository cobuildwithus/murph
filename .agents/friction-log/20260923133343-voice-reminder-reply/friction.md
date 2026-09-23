---
title: 'Voice reminder reply matcher rejects truthful negation'
severity: 'minor'
---

## Expected Behavior

The focused voice reminder journey should accept an accurate destination statement when the required tool effect, schedule, and messaging channel are correct.

## Current Behavior

Its negative regular expression matches a call-delivery phrase even when that phrase is explicitly negated. This can fail an otherwise correct live journey and trigger unnecessary provider reruns.

## Possible Solution

Remove the unqualified duration-and-call alternative from the negative matcher. Preserve the exact save count, tool result, schedule, messaging destination, and remaining forbidden-claim checks. Parent reply review still owns semantic contradictions.

## Minimal Reproducible Example

Inspect the negative reply assertion in the voice reminder destination journey in `packages/assistant-engine/test/assistant-codex-real-e2e.test.ts`. Negating a match does not change whether its `during.*call` alternative matches; the matcher therefore treats denial and affirmation alike.

## Context

Found while validating the native voice Codex release port. The isolated test correction is included with the task; production instructions and behavior are unchanged.
