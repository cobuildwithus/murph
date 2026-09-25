---
title: 'Focused live-test selector errors omit matching test names'
severity: 'minor'
---

## Expected Behavior

When a focused live-test selector matches multiple journeys, show the matching names so the caller can select one without starting provider work. Offer a supported discovery command for a selector that matches none.

## Current Behavior

The live runner reports only the match count and asks for a more specific pattern. It has no discovery option. Parameterized names can contain quotes inserted by Vitest that are absent from the source title, so copying an apparently exact source title can then match nothing. Recovering the exact names requires reconstructing the underlying Vitest list command from the runner implementation.

## Possible Solution

Include a bounded list of matching names in ambiguous-selector errors and expose a list mode or a concrete discovery hint. Preserve the requirement to run one journey at a time.

## Minimal Reproducible Example

Run `pnpm test:assistant:live -- --test 'real Codex'`. The pattern matches multiple journeys, but the error provides no names. Inspect a parameterized test title and compare it with the rendered names from Vitest list before attempting to narrow the selector.

## Context

This slows focused verification and causes avoidable retries before any model test starts. The workaround is read-only test enumeration; no credentials or production data are needed to reproduce the selection problem.
