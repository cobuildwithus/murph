---
title: 'Cloudflare mixed Vitest projects do not release coordinator'
severity: 'minor'
---

## Expected Behavior

Every project in the Cloudflare Node Vitest workspace should finish and release
the coordinator when all tests settle.

## Current Behavior

The existing runner, platform, and deploy projects exit together in the
canonical command, and the actual-package Containers helper exits alone or
beside either platform or deploy. Running all four projects in one process
remains alive without new output beyond the clean three-project duration,
forcing a bounded interruption. The optional no-cache parallel verifier can
also hit an older nondeterministic coordinator shutdown hang in the original
three-project workspace.

## Possible Solution

Make mixed-project handle ownership visible in Vitest diagnostics. The local
workaround gives the real-package helper a dedicated Vitest config and runs it
after the three existing projects.

## Minimal Reproducible Example

Register the helper alongside the three Cloudflare Node workspace projects and
observe that the process does not exit. Then move the helper into a dedicated
config and run it after the original workspace; both invocations exit
successfully.

## Context

An actual-package readiness regression test needs a dedicated
`cloudflare:workers` alias and package de-externalization. Sequential execution
keeps the canonical suite deterministic without weakening that production-code
coverage.

<!-- Describe how this affected you, and what you were trying to accomplish. -->
