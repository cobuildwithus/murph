---
title: 'Frontend guide points to removed repo-local design skill paths'
severity: 'minor'
---

## Expected Behavior

Frontend guidance should point agents to an available Impeccable and shadcn skill entrypoint before UI work.

## Current Behavior

`agent-docs/FRONTEND.md` names repo-local skill directories that are absent from a clean checkout, forcing agents to discover an installed fallback before satisfying the documented frontend workflow.

## Possible Solution

Route the guide to the canonical available skill names instead of checkout-local directories.

## Minimal Reproducible Example

1. Start from a clean checkout.
2. Read `agent-docs/FRONTEND.md` before an `apps/web` change.
3. Attempt to open the two referenced skill entrypoints.
4. Observe that neither path exists.

## Context

This adds avoidable ambiguity before frontend implementation and can cause agents to skip current design-system or Base UI guidance.
