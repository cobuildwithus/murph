---
title: 'Hosted-local no-bundle E2E accepts stale workspace package artifacts'
severity: 'minor'
---

## Expected Behavior

A hosted-local E2E run with `--no-bundle` should either prepare every changed
public workspace package copied into the Worker bundle or fail fast with the
exact package build required.

## Current Behavior

The harness copied an existing hosted-execution `dist` artifact that predated a
newly exported route helper. Typecheck and focused source tests were green, but
Worker startup retried until its health deadline because the copied runtime
module did not export the helper.

## Possible Solution

Include copied workspace-package artifacts in the prepared-bundle freshness
manifest, or add a source-to-dist preflight that names the stale package before
stack startup.

## Minimal Reproducible Example

1. Add an exported hosted-execution route helper and consume it from the
   Cloudflare Worker.
2. Leave an older hosted-execution `dist` directory present.
3. Run a hosted-local E2E with `--no-bundle`.
4. Observe Worker health retries caused by the missing runtime export.
5. Build hosted-execution and rerun; the stack starts normally.

## Context

This produced a false end-to-end startup failure and delayed a hosted runtime
handoff regression by several minutes.
