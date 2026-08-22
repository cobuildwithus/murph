---
title: 'Policy prose refactor can leave release coverage assertions stale'
severity: 'minor'
---

## Expected Behavior

Changes to workflow or ReviewGPT policy wording update the release coverage assertions that verify those contracts in the same pull request, so unrelated pull requests keep a green CLI gate.

## Current Behavior

A wording and ownership refactor can merge while exact `toContain` assertions still expect the previous prose. The next unrelated pull request then fails the CLI coverage job even though its own changed behavior is unaffected.

## Possible Solution

Keep exact assertions for stable contract tokens, but normalize intentional line wrapping and assert moved policy details against their canonical owner. Add a focused check to policy-edit pull requests that runs the owning release coverage test.

## Minimal Reproducible Example

1. Change a policy phrase or move it from a workflow document into its canonical review prompt.
2. Leave an exact string assertion for the former wording or owner unchanged.
3. Run the release script coverage audit and observe an unrelated assertion failure.

## Context

This creates fleet-wide CI noise and forces unrelated feature work to repair base-owned test drift before its own checks can complete.
