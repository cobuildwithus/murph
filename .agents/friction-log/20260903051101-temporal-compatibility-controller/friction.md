---
title: 'Temporal compatibility controller changes require a manual bootstrap PR'
severity: 'major'
---

## Expected Behavior

A protected default-branch compatibility controller should have a documented, testable upgrade path that lets a successor controller become trusted without weakening the required check or coupling its admission to new producer behavior.

## Current Behavior

The Temporal compatibility workflow correctly executes only the controller from the public default branch. A pull request that simultaneously replaces that controller and expands its producer fixture is therefore evaluated by the retired controller. When the retired private reader policy rejects the expanded fixture, the successor controller cannot validate or install itself even though its private counterpart is already live.

## Possible Solution

Document and guard a two-step upgrade protocol: first land a producer-compatible controller-only bootstrap under the existing required check, then land producer or runtime changes after the new default controller is trusted. Add a focused contract test or release checklist that rejects controller-plus-incompatible-fixture coupling.

## Minimal Reproducible Example

1. Keep the protected compatibility workflow on trusted default-branch code.
2. In one pull request, change the controller from a pinned private tag to private main and add a producer field rejected by retained readers in the pinned matrix.
3. Run the required compatibility status.
4. Observe that the old controller evaluates the new fixture, fails, and never permits the new controller to become trusted.

## Context

This blocked an otherwise reviewed release-admission pull request and required an additional controller-only bootstrap change. The required check remained fail-closed throughout.
