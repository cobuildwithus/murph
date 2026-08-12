---
title: 'ReviewGPT full-snapshot anchor guidance conflicts with packager preflight'
severity: 'minor'
---

## Expected Behavior

The later-round ReviewGPT guide and its packager preflight should require the same context-anchor head for a sensitive full-snapshot audit.

## Current Behavior

The guide says later rounds should pass the most recent full-snapshot head as the context anchor. For a sensitive later round, the packager selects another full snapshot and rejects that documented anchor because it requires the current PR head instead. The audit stops before browser submission and must be retried with undocumented metadata.

## Possible Solution

Document the full-snapshot rule separately from same-thread delta rounds, or make the packager derive the current-head anchor when it selects full-snapshot context.

## Minimal Reproducible Example

1. Prepare a clean pushed sensitive PR for a later substantive ReviewGPT round.
2. Pass the previous full-snapshot head as the context anchor, following the guide.
3. Run the standard PR review command.
4. Observe preflight reject the invocation because a full-snapshot anchor must equal the current PR head.

## Context

This delays the required privacy-sensitive completion gate but does not submit a duplicate model review because the failure occurs before browser staging.
