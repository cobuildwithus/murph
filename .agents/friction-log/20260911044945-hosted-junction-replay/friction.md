---
title: 'Hosted Junction replay treats mailbox handoff as complete device work'
severity: 'minor'
---

## Expected Behavior

The hosted Junction direct-resource replay should wait within its existing deadline until its entire dirty payload frontier is drained, then verify current canonical Browser Vault content.

## Current Behavior

The scenario uses generic hosted completion, which intentionally accepts quiescence with a retained future retry. It then samples the dirty frontier once. A valid connection-scoped continuation can therefore fail the scenario before its remaining payloads run.

## Possible Solution

Use a Junction-only completion waiter that retains generic quiescence, requires both dirty flags false and zero pending resources, revalidates current status after acknowledgment, and preserves the existing failure and canonical-content assertions under one deadline.

## Minimal Reproducible Example

Run the focused hosted-local-junction-replay-completion helper tests. The retained-future-retry case supplies a quiescent status while the canonical dirty frontier remains pending, then clears it at the existing retry boundary. Generic completion alone would settle before that boundary.

## Context

The real Junction consumer proof independently drains the full committed synthetic smoke fixture through the retained mailbox owner. Autonomous hosted delivery remains a separate integration proof.
