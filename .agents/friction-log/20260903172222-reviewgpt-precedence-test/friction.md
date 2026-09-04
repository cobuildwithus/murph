---
title: 'ReviewGPT precedence test invokes real pnpm with a temporary HOME'
severity: 'major'
---

## Expected Behavior

The ReviewGPT precedence test should isolate toolchain preparation while exercising the real ReviewGPT dry-run behavior.

## Current Behavior

The test replaces `HOME` with a temporary directory but leaves the real `pnpm` on `PATH`. The wrapper then tries to reconcile the repository workspace against a different pnpm store and aborts without an interactive terminal.

## Possible Solution

Provide a harness-local `pnpm` that validates the frozen install command and delegates the ReviewGPT execution to the installed binary.

## Minimal Reproducible Example

1. Install the repository dependencies with the normal user store.
2. Run the CLI release-script coverage test in a non-interactive process.
3. Observe pnpm reject removal of the existing modules directory because the temporary `HOME` selects a different store.

## Context

This makes the required acceptance gate fail in unrelated changes and lets a unit test attempt to mutate the shared developer workspace.
