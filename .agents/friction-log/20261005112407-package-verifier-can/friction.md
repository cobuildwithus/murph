---
title: 'Package verifier can report failure after a successful worker exit'
severity: 'minor'
issue: 'cobuildwithus/murph#4040'
---

## Expected Behavior

The package coverage scheduler should honor a worker's persisted completion status even when the worker exits during its liveness check. A genuinely dead worker with no completion status must still fail verification.

## Current Behavior

The scheduler checks for an absent status file before observing worker liveness. If the worker writes status zero and exits between those observations, the missing-status branch records failure without rechecking the file. A deterministic synthetic interleaving makes the current scheduler return one when every worker succeeded. An existing interlock CI test also failed without identifying the failed shell assertion; its precise interleaving is unconfirmed.

## Minimal Reproducible Example

Extract the actual `run_all_package_coverage` function using the existing shell test harness. Return two synthetic package owners from the plan stub and hold their workers on an owned release file. At the first owned `kill -0` observation, release the worker, wait for its exact status file and child exit, then perform the liveness observation. The current scheduler reports failure. Rechecking status existence after the liveness observation preserves success; nonzero and missing-status controls must continue to fail.

## Context

The race can block unrelated PR verification and encourages uninformative reruns. Correct the status observation boundary rather than weakening failure handling or adding delays. Keep the regression deterministic and retain owned-child cleanup.
