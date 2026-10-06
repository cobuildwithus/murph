---
title: 'Live assistant runner cannot target a locally built Codex binary'
severity: 'minor'
---

## Expected Behavior

`pnpm test:assistant:live` can run a focused real-Codex journey against an explicitly selected Codex binary, such as a locally built patched release matching the deployed runner.

## Current Behavior

`scripts/run-assistant-real-codex-e2e.ts` always overwrites `MURPH_REAL_CODEX_COMMAND` with the npm helper binary, so a patched native build can only be exercised by invoking vitest directly with hand-assembled runner environment.

## Possible Solution

Add an explicit `--codex-command <path>` option that keeps the npm binary as the default.

## Minimal Reproducible Example

Set `MURPH_REAL_CODEX_COMMAND=/path/to/patched/codex` and run `pnpm test:assistant:live -- --test "<pattern>"`; the run uses `packages/assistant-engine/node_modules/.bin/codex`.

## Context

Needed to measure live first-frame latency and compaction behavior on a patched Codex transport build.
