---
title: 'Full live suite includes a benchmark with unreproducible local fixtures'
severity: 'minor'
---

## Expected Behavior

A full local Codex live run can prepare every required synthetic/public fixture,
or reports missing prerequisites before provider work begins.

## Current Behavior

The shared live tag includes 21 meal-intake benchmark cases requiring an external
image directory and local food-label API. Images have pinned hashes but no
checked-in retrieval manifest or synthetic-label generation recipe. The cases
fail at setup after earlier provider journeys have already run. An available
local labels database also rejects the diagnostic API's reads with PostgreSQL
error 42501; the alternate fixture database is not a representative corpus.

## Minimal Reproducible Example

Run a `meal intake speed` journey without `MURPH_MEAL_INTAKE_BENCH_IMAGE_DIR`
and `MURPH_MEAL_INTAKE_BENCH_DATA_API_PROXY`.

## Possible Solution

Provide a reproducible public-image manifest and synthetic-label generator, plus
a secret-safe prerequisite check for the local labels service. Keep environment
blocks distinct from model failures in the full-suite report.

## Context

A requested Terra versus Sol comparison must not attribute missing benchmark
fixtures to either model's behavior.
