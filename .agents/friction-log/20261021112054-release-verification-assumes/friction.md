---
title: 'Release verification assumes the obsolete pipeline always receives SIGPIPE'
severity: 'minor'
issue: 'cobuildwithus/murph#4277'
---

## Expected Behavior

The pre-commit regression test should prove the current hook regenerates CLI artifacts for a large staged diff regardless of kernel pipe scheduling.

## Current Behavior

The test first requires the obsolete git-diff and grep-q pipeline to exit nonzero. That obsolete pipeline can return zero when buffering or scheduling allows the producer to finish, so release checks fail before checking the current hook.

## Minimal Reproducible Example

Run the large staged CLI diff case in scripts/developer-workflow-entrypoints.test.ts on a Linux runner. The legacy gate may return zero while the current hook succeeds and records artifact generation. Its status is not a portable deterministic assertion.

## Possible Solution

Remove the obsolete negative-control helper and timing assertion; retain direct current-hook regeneration, irrelevant-diff, failure-diagnostic and artifact coverage.

## Context

A repository verification test blocks protected release proof despite the current hook using a path-scoped Git tree comparison.
