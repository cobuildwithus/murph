---
title: 'ReviewGPT packaging exceeds the child output buffer with expected exclusions'
severity: 'minor'
---

## Expected Behavior

The guarded full repository snapshot should reach review submission with its privacy exclusions intact.

## Current Behavior

The packager emits one stderr warning per excluded asset. A large static asset tree pushes expected diagnostics over the ReviewGPT spawnSync default output limit, terminating packaging before PR context is appended. Running the same guarded packager directly succeeds.

## Possible Solution

Summarize expected exclusion warnings in the repository wrapper while retaining the complete invocation-owned diagnostic file and preserving other diagnostics and the original exit status.

## Minimal Reproducible Example

Run the guarded full PR packager on a snapshot whose expected exclusions produce more than one MiB of stderr, then invoke it through ReviewGPT. The direct command succeeds while the buffered child fails before submission.

## Context

This prevents the required final review for a provider branding change. No review request was accepted before the failure.
