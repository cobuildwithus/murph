---
title: 'Default-branch assistant coverage failure blocks unrelated pull requests'
severity: 'minor'
---

## Expected Behavior

The default branch should retain a green assistant schema contract so unrelated pull requests can use required coverage as candidate evidence.

## Current Behavior

A merged group-consult schema change advertises participant targeting in the root contract but omits it from every action-specific schema. The deterministic coverage test fails on the default branch, so unrelated pull requests repeat the same long assistant-coverage failure.

## Possible Solution

Keep the focused group-tool contract test required before merge and avoid admitting a candidate while its assistant coverage owner is still pending or canceled.

## Minimal Reproducible Example

Run the focused assistant group-tool test on the affected default-branch commit. The family-bounded schema assertion expects participantTarget but the ask and handoff branches expose only groupLabel plus their required payload.

## Context

This blocked a documentation and review-tooling pull request twice even though that pull request does not modify the assistant package.
