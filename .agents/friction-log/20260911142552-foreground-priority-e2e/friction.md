---
title: 'Foreground priority E2E still requires retired runtime replacement'
severity: 'minor'
---

## Expected Behavior

The foreground-priority release scenario should verify that an already authorized system-mailbox owner continues foreground input in place after its canonical checkpoint acknowledges, preserving the exact fence and target.

## Current Behavior

The scenario still expects default processing mode and a replacement attempt at provider start. The controller and runtime now intentionally retain an eligible system-mailbox owner, so correct foreground continuation fails the stale assertion and blocks Web production admission.

## Possible Solution

Align the E2E owner assertions and continuation observation with the existing runtime contract. Preserve checkpoint ordering, standby preservation, the reply deadline, exactly-once reply delivery, and subsequent system work.

## Minimal Reproducible Example

Start the synthetic foreground-priority scenario with an authorized system-mailbox owner and hold its canonical checkpoint acknowledgement. Append signed foreground input, release the checkpoint barrier, and inspect the active fence before the provider responds. The same authorized system-mailbox fence is retained, while the old assertion requires default mode and a different attempt.

## Context

PR #3280 intentionally introduced in-place foreground continuation. The release E2E retained its previous replacement-only expectation even though the focused controller tests already require reuse of the exact child.
