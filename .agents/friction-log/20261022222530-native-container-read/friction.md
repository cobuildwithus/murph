---
title: 'Native container read failures lose diagnostic boundaries'
severity: 'minor'
---

## Expected Behavior

The deployment read adapter should distinguish transport, HTTP rejection, JSON parsing, and invalid response contracts without rendering provider payloads or identities.

## Current Behavior

The list/detail/rollout read catches replace every failure with the same generic TypeError. The composed application-identity reader can erase attribution again. Synthetic HTTP and malformed-JSON inputs therefore become indistinguishable.

## Minimal Reproducible Example

Inject a fetch implementation returning HTTP 503, then one returning an invalid JSON body, into createCloudflareContainerProvider. Both reads reject with the same diagnostic, making the failing boundary unavailable to the existing deployment workflow.

## Context

The existing deployment provider read is the correct observation owner. Preserve strict validation and fail-closed activation; add only finite diagnostic categories and bounded HTTP status.
