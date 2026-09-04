---
title: 'Hosted-local graceful shutdown control ignores standby-owned runtime fences'
severity: 'minor'
---

## Expected Behavior

The hosted-local graceful shutdown control should signal the Container instance named by the active UserRunner write fence, whether the owner is the exact-user container or a claimed standby container.

## Current Behavior

The control always resolves the exact-user container name. After foreground work claims a standby container, the control starts and stops an unused exact-user container while the active standby invocation and durable fence remain live until the test times out.

## Possible Solution

Resolve the active fence through the UserRunner test control, route its stored container name through the existing exact-user/standby namespace router, and keep the production Container classes unchanged.

## Minimal Reproducible Example

Run the focused Cloudflare route test with an active fence whose container name is an opaque standby slot, then request the shutdown checkpoint publication barrier with `action=shutdown`. The standby RPC is not called.

## Context

This blocks the private foreground-reply-priority admission scenario after standby allocation is enabled.
