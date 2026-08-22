---
title: 'Protected main can fail a release-only workspace boundary guard'
severity: 'minor'
---

## Expected Behavior

Required pull-request checks should run every workspace boundary rule needed by release acceptance, so protected main remains releaseable after green merges.

## Current Behavior

A clean current main can contain tracked cross-workspace imports that pass the required pull-request checks but make `pnpm release:check` fail before release metadata is generated.

## Possible Solution

Run `node scripts/verify-workspace-boundaries.mjs` in a required pull-request lane that cannot be skipped by diff routing, or prove the existing required lane executes the same full rule set.

## Minimal Reproducible Example

1. Start from a clean current main worktree with dependencies installed.
2. Run `node scripts/verify-workspace-boundaries.mjs`.
3. Observe cross-workspace import findings even though the commits entered main through green required pull-request checks.
4. Run `pnpm release:check` and observe that the same guard blocks the release before version generation.

## Context

This delayed an urgent patch-package release needed for a staged hosted-runtime incident rollout.
