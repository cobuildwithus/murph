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

The same full run also exposed stale model names and clinical-date fixtures,
plus wording assertions that reject valid equivalent responses or negated
claims. Corrected fixtures are covered by focused reruns; original outcomes stay
in the comparison record. A follow-up should audit the remaining assertions
against their intended product invariant before using raw suite pass rate as a
model-ranking metric. Do not relax exact writes, authorization, or safety checks.

The follow-up audit corrected stale calendar ownership, clock and model fixtures,
missing hosted automation availability, instructions that were not persisted by
the edit mock, and outdated requirements for extra Goal readbacks. Assertions now
permit bounded harmless discovery and equivalent truthful wording while retaining
exact writes, state, authorization, and privacy. The duplicate prescribed schema
discovery journey and its rollout-parsing helper were removed; the ordinary
production-derived reminder journey remains.
