---
title: 'Natural goal live journey can pass without Commons artifacts'
severity: 'minor'
issue: 'cobuildwithus/murph#4515'
---

## Expected Behavior

The natural goal latency journey should establish that its local public-reference artifacts are available before comparing normal discovery behavior.

## Current Behavior

The prepared CLI can start while generated Health Commons files are absent. The journey checks discovery command counts and accepted plan persistence, so it can pass while both public-goal lookup and knowledge search use unavailable-artifact fallback behavior. This changes the measured path without failing the proof.

## Possible Solution

Add a local artifact preflight or document and enforce the Health Commons generation prerequisite for this focused journey. Keep separately named fallback coverage when testing unavailable references intentionally.

## Minimal Reproducible Example

In a checkout without generated Health Commons artifacts, run `pnpm build:test-runtime:prepared`, then the focused `real natural goal canary journey` with a compatible native runner. Inspect the public-reference results as well as the existing passing assertions. Run `pnpm health-commons:generate` and repeat to exercise available-reference discovery.

## Context

Latency comparisons require identical available inputs. Command counts alone cannot distinguish successful empty discovery from unavailable reference data.
