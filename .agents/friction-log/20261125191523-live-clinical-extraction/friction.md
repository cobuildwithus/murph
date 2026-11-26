---
title: 'Live clinical extraction journeys cannot vary reasoning effort without editing the test'
severity: 'minor'
---

## Expected Behavior

`pnpm test:assistant:live` can run a clinical extraction journey at the model and
reasoning effort the hosted runtime uses, so a model or effort change can be
measured against the same journeys without touching test code.

## Current Behavior

The runner accepts `--model` but not a reasoning effort. Each clinical journey
hard-codes its own effort, so comparing two efforts on one model requires a
temporary local edit to every journey's call site.

## Possible Solution

Add a `--reasoning-effort` option that the clinical journeys read, defaulting to
the effort production uses for clinical enrichment.

## Minimal Reproducible Example

1. Run `pnpm test:assistant:live -- --test "views rendered history evidence" --model <model>`.
2. Try to repeat the same journey at a different reasoning effort.
3. No runner option exists; the effort is fixed in the test source.

## Context

Found while measuring whether a cheaper model holds clinical document
extraction quality at medium and high effort.
