---
title: 'Vercel initial Web typecheck exhausts Standard build memory'
severity: 'minor'
---

## Expected Behavior

The Vercel production entrypoint completes full Web typechecking within the existing Standard build memory budget before starting Next compilation.

## Current Behavior

The initial Web compiler uses automatic checker parallelism. A production build stopped in that check with exit code 137, and the platform reported an out-of-memory event before Next compilation started.

## Possible Solution

Use the existing MURPH_TSC_WEB_CHECKERS control to bound the Vercel entrypoint to one checker. Preserve the same project, diagnostics, migration order and deployment admission checks.

## Minimal Reproducible Example

Run the production entrypoint on the Standard build machine with automatic Web checker selection. Observe the typecheck phase and platform memory report. Compare with the same full check using MURPH_TSC_WEB_CHECKERS=1.

## Context

A release with passing focused validation and PR CI failed during the hosted Web build. The build has a narrower memory budget than local development; no new build service or larger machine is required by the proposed correction.
