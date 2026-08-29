---
title: 'Assistant-runtime full Vitest suite races temp-root teardown across isolated workers'
severity: 'minor'
---

## What happened

The diff-scoped assistant-runtime suite reported unrelated foreground timing failures together with unhandled ENOENT errors from background state-lock work after a test removed its temporary vault root.

## Impact

The broad verification result becomes non-diagnostic: affected tests fail in the full multi-file run but pass when rerun individually, forcing slow manual isolation before a release decision.

## Reproduction

Run the assistant-runtime Vitest suite with isolation enabled and no coverage. The observed run passed 2,568 tests, failed four timing-sensitive tests, and emitted an unhandled temp-root chmod or mkdir ENOENT.

## Workaround

Rerun each reported test alone and keep the exact isolated results alongside the broad-suite output.
