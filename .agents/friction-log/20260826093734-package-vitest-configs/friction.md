---
title: 'Package Vitest configs reject repo-root file filters'
severity: 'minor'
---

## Expected Behavior

A documented package Vitest command should run its target file from the repository root or fail with a direct cwd hint.

## Current Behavior

Running Vitest from the repository root with a package config and a repository-relative test path exits with No test files found because the package include is interpreted against the caller working directory.

## Possible Solution

Document a package-owned wrapper or make the supported command normalize cwd and file filters.

## Minimal Reproducible Example

From the repository root, run the assistant-runtime Vitest config with its repository-relative hosted runtime test path. The runner reports that no test files match. Running the same config and package-relative path from the package directory succeeds.

## Context

This caused repeated false verification failures while isolating a hosted runtime regression.
