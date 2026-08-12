---
title: 'ReviewGPT wrapper prints an absolute checkout path before redaction'
severity: 'minor'
---

## Expected Behavior

All ReviewGPT wrapper output should redact local checkout paths and account identifiers before any line is emitted.

## Current Behavior

The package-manager script banner can print the absolute repository checkout path before the wrapper begins its own redacted output.

## Possible Solution

Invoke the underlying binary without the package-manager working-directory banner, or redact the banner before forwarding it.

## Minimal Reproducible Example

From a nested checkout path, run the repository ReviewGPT script through the package manager and inspect the first banner line.

## Context

This forces manual output review during repository-required ReviewGPT lanes and can disclose local machine identifiers in captured task output.
