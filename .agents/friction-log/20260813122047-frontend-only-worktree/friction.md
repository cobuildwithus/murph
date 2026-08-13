---
title: 'Frontend-only worktree helper ignores Temporal disable override'
severity: 'minor'
---

## Expected Behavior

A frontend-only design-catalog run can disable Temporal with MURPH_DEV_TEMPORAL=disabled, as the startup error recommends.

## Current Behavior

The worktree environment builder unconditionally resets MURPH_DEV_TEMPORAL to managed after reading the caller environment, so the recommended override is ignored and startup still requires an external worker package.

## Possible Solution

Preserve an explicit disabled override for frontend-only worktree startup, or add a dedicated frontend-only helper that supplies the isolated database, ports, and Next build directory without starting the hosted runtime.

## Minimal Reproducible Example

1. Run the worktree doctor for a synthetic slug.
2. Start the worktree helper with MURPH_DEV_TEMPORAL=disabled.
3. Observe that startup still enters the managed Temporal path and requests an external worker package.

## Context

This blocks the documented local design-catalog proof path and forces a separate frontend-only environment workaround.
