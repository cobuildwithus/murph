---
title: 'Worktree frontend-only dev example omits required hosted URL overrides'
severity: 'minor'
---

## Expected Behavior

The documented frontend-only worktree command should start the Web app on its isolated port without inheriting incompatible hosted callback origins.

## Current Behavior

Running the documented command after linking the worktree fails during Next configuration because the device callback hostname differs from the hosted-onboarding hostname inherited through the development environment.

## Possible Solution

Include the local device-sync, hosted-onboarding, allowed-origin, and hosted-Web URL overrides in the frontend-only example, or route the example through a helper that sets them consistently.

## Minimal Reproducible Example

1. Link a secondary worktree to the Web project.
2. Run the documented frontend-only command on an isolated port.
3. Observe the hostname-invariant failure before the app serves.

## Context

This blocks synthetic design-catalog screenshot capture from a secondary worktree until the omitted local-origin overrides are supplied.
