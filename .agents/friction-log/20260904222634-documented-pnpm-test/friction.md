---
title: 'Documented pnpm test separator drops Vitest file filters'
severity: 'minor'
issue: 'cobuildwithus/murph#2917'
---

## Expected Behavior

A focused test command should run only the named test files.

## Current Behavior

The package scripts append arguments to Vitest verbatim. An extra `--` moves subsequent filenames into the parser's double-dash option instead of positional test filters, so a supposedly focused run starts the package suite. The changelog verification README currently recommends this form.

## Possible Solution

Document direct `pnpm --dir <package> exec vitest run ... <test-file>` commands, or omit the extra separator when invoking the package test script.

## Minimal Reproducible Example

Compare the argument parsing for `pnpm --dir packages/assistant-engine test -- test/assistant-generated-delivery-files.test.ts` with `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-generated-delivery-files.test.ts`. Vitest's CAC parser stores tokens after `--` separately from positional filters.

## Context

Unexpected suite expansion delays focused verification and consumes local resources. The direct Vitest invocation preserves the intended bounded scope.
