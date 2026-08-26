---
title: 'Frog autofix implementation review ignores isolated browser lanes'
severity: 'major'
---

## Expected Behavior

The local Frog autofix worker should route ReviewGPT implementation authoring through the repository's existing automatic pool of isolated authenticated browser lanes.

## Current Behavior

The generated implementation-review config hardcodes the everyday Brave profile and CDP port 9452. When that profile is already open without remote debugging, ReviewGPT exits before authoring a patch even though isolated managed lanes are healthy.

## Possible Solution

Reuse `scripts/review-gpt.config.sh` for browser-lane selection, then override only the Frog-specific package command and response settings in the private generated config.

## Minimal Reproducible Example

1. Keep the ordinary Brave profile open without a CDP listener.
2. Confirm at least one isolated ReviewGPT lane is available.
3. Run one eligible local Frog autofix task.
4. Observe implementation authoring stop with ReviewGPT status 1 before a candidate is published.

## Context

This prevents the installed local Frog worker from repairing an otherwise admitted, local-agent-only issue and unnecessarily couples unattended automation to the user’s interactive browser.
