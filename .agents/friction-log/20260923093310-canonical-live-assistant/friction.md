---
title: 'Canonical live assistant journeys start the model before checking the built CLI'
severity: 'minor'
---

## Expected Behavior

The focused canonical live journey should reject a missing shipped CLI before starting a model turn and name the required local build command.

## Current Behavior

After dependency installation in a fresh worktree, packages/cli/dist/bin.js is absent. The canonical fixture still starts the model and routes tool calls to that missing entrypoint. The model returns a service-failure reply and the first canonical-record assertion fails, obscuring the build prerequisite and spending a live turn before useful proof can begin.

## Possible Solution

Preflight the shipped CLI entrypoint in createCanonicalLiveFixture before starting a provider action, with a concise build instruction. Keep the actual shipped CLI as the proof boundary.

## Minimal Reproducible Example

1. Create an isolated worktree and install the locked dependencies without building packages.
2. Run the focused real model canonical reminder create fire and cancel journey through test:assistant:live with an authenticated local profile.
3. Observe reminder creation fail before the scheduler assertions because the fixture wrapper targets the missing dist entrypoint.
4. Build the existing CLI dependency graph and assemble the CLI surface before rerunning.

## Context

Discovered while verifying runtime request reductions. This is test preparation friction, independent of the scheduling behavior under test. No provider transcript or credential is needed to reproduce it.
