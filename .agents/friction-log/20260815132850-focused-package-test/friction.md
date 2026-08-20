---
title: 'Focused package test scripts ignore caller filters after the separator'
severity: 'minor'
---

## Expected Behavior

Passing a test file and name filter to a package test script should execute only that focused test.

## Current Behavior

The package scripts append their own separator before caller arguments, so Vitest receives the file and name filter after a second separator and runs the package's configured workspace suite instead.

## Possible Solution

Forward caller arguments directly to Vitest without inserting an extra separator.

## Minimal Reproducible Example

Run `pnpm --dir packages/device-syncd test -- junction-provider.test.ts -t "synthetic focused case"` and observe unrelated test files execute.

## Context

This makes scoped verification unexpectedly expensive and can produce unrelated timeouts under concurrent package checks.
