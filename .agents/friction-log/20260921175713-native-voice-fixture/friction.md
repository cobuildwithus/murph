---
title: 'Native voice fixture starts unrelated plugin downloads during cleanup'
severity: 'minor'
---

## Expected Behavior

The synthetic native voice contract tests should exercise only their local provider and dynamic tool, then remove the isolated Codex home after stopping the CLI.

## Current Behavior

The fixture inherits Codex's enabled plugin marketplace startup. A background Git checkout can still write the temporary home during teardown, causing recursive removal to fail with ENOTEMPTY after the voice assertions pass.

## Possible Solution

Disable plugins in this isolated fixture's Codex configuration. Retain the existing process shutdown and strict cleanup behavior.

## Minimal Reproducible Example

Run the assistant-engine native voice test file on Linux with MURPH_TEST_CODEX_COMMAND pointing to the CLI extracted from the production runner image. The two direct native protocol cases can fail during temporary plugin checkout removal after successful assertions.

## Context

Observed in the runner permission gate while completing the native voice integration. This is test isolation, not a production voice failure.
