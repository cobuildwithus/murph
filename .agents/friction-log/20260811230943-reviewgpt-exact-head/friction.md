---
title: 'ReviewGPT exact-head gate fails after packaging when the ChatGPT file library is full'
severity: 'minor'
---

## Expected Behavior

A protected exact-head ReviewGPT run should attach its guarded audit package to
the selected ChatGPT thread and proceed to review, or fail before packaging with
an actionable quota status and supported recovery path.

## Current Behavior

The PR-head guard passes and the full audit ZIP is created, but draft staging
exits with a generic tool error before the prompt is sent when ChatGPT reports
that its file library is full. Repeating on a second managed browser lane has
the same result. The required ReviewGPT gate cannot run even though repository
packaging and authentication both succeeded.

## Possible Solution

Detect the file-library-full banner explicitly and return a dedicated error
with a documented recovery option. If ChatGPT still permits thread-scoped files
when the reusable library is full, stage through that supported path without
weakening the guarded exact-head attachment contract.

## Minimal Reproducible Example

1. Use a signed-in managed browser profile whose ChatGPT file library is full.
2. Run a protected PR preset with `--wait` against a clean, exact pushed head.
3. Observe successful PR preflight and audit-ZIP creation.
4. Observe draft staging fail before send with a generic error rather than a
   quota-specific recovery instruction.

## Context

This blocks the repository-required preliminary and final ReviewGPT gates and
forces the task to distinguish a connector-only fallback from the protected
file-attached review contract.
