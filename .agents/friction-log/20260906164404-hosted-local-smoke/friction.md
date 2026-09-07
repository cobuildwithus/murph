---
title: 'Hosted-local smoke stops before standby preparation deadline'
severity: 'minor'
---

## Expected Behavior

Hosted-local readiness should retain the deployment smoke owner's bounded attempt budget while polling quickly, including when standby inventory is preparing multiple containers.

## Current Behavior

The harness injects thirty one-second attempts. Standby preparation has an existing seventy-five-second deadline and performs a full CLI preflight after cold health succeeds, so the outer harness can terminate valid preparation prematurely.

## Minimal Reproducible Example

Run a standby-enabled hosted-local foreground scenario with two fresh slots. Each slot becomes healthy, then runs its disposable CLI smoke while the coordinator reports provisioning. The local override can expire before the existing preparation deadline.

## Context

Reuse the existing smoke attempt default and retain the local polling interval, explicit caller overrides, readiness checks and fatal E2E failure behavior.
