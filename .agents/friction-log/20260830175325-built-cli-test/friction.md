---
title: 'Built CLI test harness ignores stale assistant-cli runtime artifacts'
severity: 'minor'
issue: 'cobuildwithus/murph#2639'
---

## Expected Behavior

A focused built vault-cli test that changes an assistant-cli command should prepare the current assistant-cli runtime artifact or fail fast with an explicit preparation requirement.

## Current Behavior

The CLI test helper considers the runtime prepared without checking assistant-cli/dist. The spawned built command can therefore execute an older assistant projection and produce a false behavior failure until the package is built explicitly.

## Possible Solution

Include the assistant-cli command artifact in the prepared-runtime manifest or add a source-to-dist freshness check that names the required package build.

## Minimal Reproducible Example

1. Change a bounded result returned by an assistant-cli command.
2. Run one built CLI regression for that command while an older assistant-cli/dist exists.
3. Observe the previous built result even though source tests and typecheck use the new behavior.
4. Build assistant-cli explicitly and rerun; the built regression then exercises the current behavior.

## Context

This caused a false failure and two long reruns while validating terminal onboarding memory recovery. The workaround was an explicit assistant-cli build before the built CLI test.
