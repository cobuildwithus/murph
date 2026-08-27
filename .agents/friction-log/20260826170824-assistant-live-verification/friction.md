---
title: 'Assistant live verification requires repeated alternate-home authorization'
severity: 'minor'
---

## Expected Behavior

When the default local subscription is usage-limited before any provider action, the focused assistant journey should make one bounded retry through an already-authenticated alternate local Codex home without requiring repeated per-run approval.

## Current Behavior

The workflow requires an explicitly authorized absolute alternate path for every retry. This can leave otherwise complete assistant changes at Hold even when safe authenticated alternate profiles are already available.

## Possible Solution

Grant standing repository authorization to discover authentication status only, select one unused alternate home, and retry the same focused journey once without copying credentials or cycling profiles.

## Minimal Reproducible Example

1. Run one focused assistant live journey through the default subscription home.
2. Receive `ASSISTANT_CODEX_USAGE_LIMIT` before any provider action.
3. Observe that the workflow stops even though an authenticated alternate profile is available.

## Context

This delays required assistant Product UX proof while preserving no additional security boundary beyond the existing no-credential-copy and single-retry rules.
