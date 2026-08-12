---
title: 'ReviewGPT wake drops the managed browser endpoint selected by send'
severity: 'minor'
---

## Expected Behavior

After `pnpm review:gpt --send` creates a conversation in a managed browser lane, the documented wake command should reconnect to that same lane without requiring the caller to infer extra state.

## Current Behavior

The send command can select a non-default managed browser endpoint, but `cobuild-review-gpt thread wake` defaults to a different endpoint. Following the documented send-and-wake sequence then exhausts its thread-export retries with fetch failures. Repeating the wake with the endpoint reported by send succeeds.

## Possible Solution

Have send emit a complete replayable wake command, persist the selected endpoint with the thread metadata, or update the workflow instructions to require `--browser-endpoint` using the endpoint printed by send.

## Minimal Reproducible Example

1. Run `pnpm review:gpt --send` while the managed browser uses a non-default debugging endpoint.
2. Run `pnpm exec cobuild-review-gpt thread wake --delay 0s --chat-url <THREAD_URL>` without `--browser-endpoint`.
3. Observe repeated export fetch failures.
4. Repeat with `--browser-endpoint <SEND_REPORTED_ENDPOINT>` and observe successful polling and artifact download.

## Context

This blocks the repository's ReviewGPT implementation handoff until the endpoint mismatch is diagnosed, and the automatic retry loop adds avoidable delay.
