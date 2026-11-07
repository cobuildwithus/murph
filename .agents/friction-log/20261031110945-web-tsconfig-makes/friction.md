---
title: 'Web tsconfig makes tsx inline evaluation exit without executing code'
severity: 'minor'
---

## Expected Behavior

The repository's tsx invocation should execute an inline diagnostic when supplied with the Web tsconfig, or reject the unsupported invocation.

## Current Behavior

On the pinned Node and tsx versions, inline evaluation with the Web tsconfig exits zero without printing a literal console message. Plain inline evaluation prints it; executing a file with the Web tsconfig works. A zero exit alone can incorrectly suggest successful diagnostic proof.

## Minimal Reproducible Example

Run `pnpm exec tsx --tsconfig apps/web/tsconfig.json -e 'console.log("probe")'` and compare with `pnpm exec tsx -e 'console.log("probe")'`.

## Possible Solution

Document the file-based invocation for Web diagnostics or fix the tsx/config interaction so inline evaluation executes or fails explicitly.

## Context

Observed while validating a read-only operational checker. Used a temporary file launcher and required its explicit success summary as evidence.
