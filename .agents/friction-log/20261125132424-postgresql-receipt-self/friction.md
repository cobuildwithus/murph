---
title: 'PostgreSQL receipt self-test rejects a passing file under a symlinked temp directory'
severity: 'minor'
---

## Expected Behavior

A passing Vitest file produces the same relative receipt path through either spelling of its temporary directory.

## Current Behavior

The PostgreSQL reporter self-test fails its positive case when the temporary root contains a symlink. Vitest reports the resolved file path and the inventory comparison computes a different relative path. The test passes when TMPDIR uses the physical path.

## Possible Solution

Canonicalize the test root before handing it to Vitest and computing receipt paths.

## Minimal Reproducible Example

Set TMPDIR to a symlink to a writable temporary directory and run `node --test scripts/run-postgres-tests.test.mjs`. Repeat with the resolved TMPDIR.

## Context

This prevents local reproduction of the release PostgreSQL discovery gate on macOS with the default temporary-directory alias.
