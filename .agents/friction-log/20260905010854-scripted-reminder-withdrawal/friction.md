---
title: 'Scripted reminder withdrawal races native Codex startup'
severity: 'minor'
---

## Expected Behavior

The live DST reminder-withdrawal fixture should inject cancellation after the failed save reaches a pending provider response on every supported Codex release.

## Current Behavior

The fixture sleeps one second after the live turn opens. Startup and tool timing can consume that delay before the pending recovery response, so the scripted final clarification wins instead of the cancellation. The identical failure reproduces on the previous pinned CLI and is intermittent on the upgraded CLI.

## Possible Solution

Synchronize the withdrawal with the stub receiving the pending response request, and hold that response until the steering RPC completes.

## Minimal Reproducible Example

Run the assistant-engine scripted runtime test named `honors a live withdrawal of a pending DST reminder` with the prior 0.151.0 pin, especially alongside other native runtime tests.

## Context

The fixed-delay fixture obscures runtime dependency upgrade verification. The scoped fix uses an explicit response barrier in test scaffolding and preserves the production withdrawal and no-write assertions.
