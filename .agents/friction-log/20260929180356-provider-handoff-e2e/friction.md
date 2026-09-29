---
title: 'Provider handoff E2E expects retired Venice default model'
severity: 'minor'
---

## Expected Behavior

The hosted provider-switch E2E should verify that a fresh invocation receives
Web's saved Venice configuration. A provider-only switch with no explicit model
uses the shipped GPT-5.6 Sol default.

## Current Behavior

The scenario expects GPT-5.6 Terra even though the canonical configuration owner
and its deterministic tests select Sol. The valid provider request therefore
fails the exact-model assertion and blocks release integration.

## Minimal Reproducible Example

Run `pnpm hosted-local e2e warm-reuse-egress` with the existing synthetic provider
fixture. After saving the Venice provider preference without a model preference,
compare the recorder's model with the expected model in the scenario. The
production resolver and its focused tests select `gpt-5.6-sol`; the E2E expects
`gpt-5.6-terra`.

## Possible Solution

Update only the expected canonical model. Retain the provider-update, wake,
request-count, fresh-invocation, Responses Lite, and cache-compatibility checks.

## Context

This test-only mismatch prevents the protected worker release from completing.
No production model selection or provider behavior needs to change.
