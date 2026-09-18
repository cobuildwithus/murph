---
title: 'Native iOS production canary rejects a healthy deployment when main advances'
severity: 'minor'
---

## Expected Behavior

The production canary executes the real native journey against the verified current production deployment, even while newer main revisions are building.

## Current Behavior

The controller compares its selected main revision with the production alias and fails before native dispatch whenever they differ. A ready production deployment therefore cannot be exercised during ordinary deployment lag.

## Minimal Reproducible Example

Keep production on protected-main commit A, advance main to commit B, and dispatch the native iOS workflow from B before its deployment completes. The controller rejects A before launching the private native journey.

## Context

This is CI controller friction. Resolve and verify the deployed revision independently from the trusted controller source, preserve protected-main ancestry and private runner bindings, and recheck the exact deployment after execution.
