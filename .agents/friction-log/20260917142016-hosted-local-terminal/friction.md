---
title: 'Hosted-local terminal errors omit underlying runtime diagnostics'
severity: 'minor'
---

## Expected Behavior

A hosted-local predeploy failure preserves the bounded, redacted runtime error and failing stage needed to diagnose the failed synthetic journey.

## Current Behavior

The scheduled-reminder gate can stop with a generic terminal `runtime_error`. Its uploaded artifact contains the test log and harness state, but the printed status exposes only `recentLogsPresent: true`; the underlying runtime exception is unavailable. The same diagnostic gap appeared on two consecutive public commits and different reminder shards.

## Minimal Reproducible Example

Run the existing hosted-local scheduled-reminder predeploy matrix. When the harness terminal-error assertion fires, inspect the uploaded reminder log and state artifact. The last-status summary identifies the error category but omits the bounded runtime-log evidence needed to explain it.

## Possible Solution

Have the existing harness failure formatter or artifact collector include a bounded metadata-only slice of the synthetic runtime logs, preserving redaction and excluding credentials, payloads and environment contents. Keep existing test assertions and deployment gates intact.

## Context

This obstructs diagnosis of a required predeploy gate. Retrying the same pinned candidate can establish whether the failure persists, but does not recover the missing exception or prove its cause.
