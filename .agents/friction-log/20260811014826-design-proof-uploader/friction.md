---
title: 'Design-proof uploader treats the documented separator as a screenshot path'
severity: 'minor'
issue: 'cobuildwithus/murph#1665'
---

## Expected Behavior

The documented `pnpm design-proof:upload -- <screenshot>` form should pass screenshot paths to the uploader, and `pnpm design-proof:upload -- --help` should show help.

## Current Behavior

The package command forwards the separator to the TypeScript CLI. The parser enters positional-only mode, treats the following help flag as a screenshot path, and fails while reading it as a file.

## Possible Solution

Align the package-script invocation, argument parser, and documented command so the separator is consumed exactly once.

## Minimal Reproducible Example

Run `pnpm design-proof:upload -- --help` in a repository worktree.

## Context

This was encountered while preparing hosted frontend proof and required using the no-separator command form.
