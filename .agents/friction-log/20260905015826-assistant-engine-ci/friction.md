---
title: 'Assistant-engine CI coverage serializes every test file'
severity: 'minor'
---

## Expected Behavior

The dedicated assistant-engine Host Support job should use its bounded runner capacity while retaining every test and the existing coverage thresholds.

## Current Behavior

The job invokes package coverage with the CI defaults, which disable file parallelism and force one Vitest worker. A completed run spent about 13 minutes in coverage: roughly 8 minutes in tests and more than 3 minutes importing code across 272 files.

## Possible Solution

Measure the dedicated package lane with two isolated file workers, keeping in-file tests sequential and leaving other package lanes unchanged.

## Minimal Reproducible Example

Run the assistant-engine package coverage command with `CI=true`. Compare against the same command with `MURPH_VITEST_FILE_PARALLELISM=1 MURPH_VITEST_MAX_WORKERS=2` and verify the complete test inventory and coverage thresholds.

## Context

This is the remaining long-running Host Support package check after the other package lanes finish. Runner queue time is a separate contributor.
