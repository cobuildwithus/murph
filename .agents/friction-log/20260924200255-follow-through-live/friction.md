---
title: 'Follow-through live fixture omits the shared exercise guide'
severity: 'minor'
---

## Expected Behavior

The focused follow-through journey should provide the same transitive skill assets as the production assistant package.

## Current Behavior

The fixture copies selected skill directories but omits the shared exercise-catalog reference. A legitimate movement guidance read exits nonzero and fails the journey's runtime-issue assertion before the intended support behavior can be accepted.

## Possible Solution

Materialize the shared reference alongside the selected skills.

## Minimal Reproducible Example

Run the focused real-Codex journey named `closes a repeated-action proposal with appropriate support: known-window`. Inspect the fixture's skill directory: `shared/exercise-catalog-runtime.md` is absent despite the domain route requiring it for movement guidance.

## Context

Found while verifying goal-setup changes. The missing fixture asset produces a test-only command error; production packages include the complete skills directory.
