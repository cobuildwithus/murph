---
title: 'ReviewGPT rejects its documented --no-tests option'
severity: 'minor'
---

## Expected Behavior

The pinned ReviewGPT command should accept every option shown by its own help output, including `--no-tests` for excluding test paths from an audit package.

## Current Behavior

Passing `--no-tests` to the pinned command is rejected as an unknown flag before the dry run can stage its package.

## Possible Solution

Align the CLI schema and help manifest so the documented kebab-case option is accepted, or remove the option from help if it is no longer supported.

## Minimal Reproducible Example

From a clean repository checkout with dependencies installed, run `pnpm review:gpt --dry-run --no-tests`.

## Context

A local automation preflight attempted to minimize an implementation package using the documented option and had to use the supported default package instead.
