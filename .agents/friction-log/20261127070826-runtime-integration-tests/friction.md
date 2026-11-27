---
title: 'Runtime integration tests use wall-clock deadlines while waiting for synthetic workspace events'
severity: 'minor'
---

## Expected Behavior

Runtime integration tests should report whether the synthetic workspace reached the expected event and preserved checkpoint ordering.

## Current Behavior

Repeated full package runs failed in different runtime cases under host contention. The shutdown checkpoint case passed on an isolated rerun. Other waits expired before device processing, attachment staging, reply delivery or retention completion. The package failure stops verification before downstream apps run.

## Minimal Reproducible Example

Run the assistant-runtime package tests on a busy shared verification host. Compare the failing checkpoint and event waits with isolated runs of the same tests on the same revision.

## Possible Solution

Synchronize assertions with the synthetic platform callbacks for the expected events and advance the idle clock explicitly. Keep an outer failure deadline for genuine hangs.

## Context

These failures interrupted verification of a change to the canonical check-in instrument. The member-action tests passed.
