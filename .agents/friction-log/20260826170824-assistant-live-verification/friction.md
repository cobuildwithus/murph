---
title: 'Assistant live verification requires repeated alternate-home authorization'
severity: 'minor'
---

## Expected Behavior

When the default local subscription fails before any provider action, the focused assistant journey should try each available authenticated local Codex home once without requiring repeated per-run approval.

## Current Behavior

The workflow stops after one alternate home. This can leave otherwise complete assistant changes at Hold even when more authenticated profiles are available.

## Possible Solution

Grant standing repository authorization to discover authentication status only and try each unused home once in stable order. Stop when a run reaches provider action, and never read or copy credentials.

## Minimal Reproducible Example

1. Run one focused assistant live journey through the default subscription home.
2. Receive `ASSISTANT_CODEX_USAGE_LIMIT` before any provider action.
3. Observe that the workflow stops after one alternate even though another authenticated profile is available.

## Context

This delays required assistant Product UX proof even though the no-credential-copy and one-attempt-per-home rules already bound the fallback.
