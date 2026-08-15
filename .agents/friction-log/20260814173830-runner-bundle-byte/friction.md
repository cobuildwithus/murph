---
title: 'Runner bundle byte budget differs between macOS and deployment Linux'
severity: 'minor'
issue: 'cobuildwithus/murph#1845'
---

## Expected Behavior

The runner entrypoint byte-budget check should give the same pass or fail result for an exact candidate on supported local macOS verification and the Linux deployment runner, or document and apply platform-specific baselines.

## Current Behavior

The exact same candidate passes the Linux runner with a static boot closure of 8076036 bytes but fails local macOS assembly at 8109219 bytes against the shared 8088470-byte budget. The platform delta prevents a hosted-local scenario from starting even though deployment-platform assembly succeeds.

## Possible Solution

Normalize the bundled output used for measurement across platforms, or maintain reviewed platform-specific baselines and report the emitting platform beside the budget result.

## Minimal Reproducible Example

1. Run hosted-local runner bundle assembly for one exact commit on the deployment Linux runner.
2. Run pnpm hosted-local e2e canonical-receipt-lost-ack-recovery for that commit on macOS.
3. Compare the reported static boot closure sizes and shared budget decision.

## Context

This blocks production-shaped local hosted E2E proof and can falsely suggest that a small owner-boundary correction added runner complexity. The deploy-platform build remains within budget.
