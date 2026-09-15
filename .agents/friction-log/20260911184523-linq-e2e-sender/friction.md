---
title: 'Linq E2E sender ignores retryable route preparation'
severity: 'minor'
---

## Expected Behavior

The synthetic signed Linq sender should honor the handler's explicit retryable route-preparation response while retaining a strict failure ceiling.

## Current Behavior

The first-contact fixture sends only once and immediately requires HTTP 202, so a concurrent route change can fail the delivery scenario on the deliberate HTTP 503 HOSTED_THREAD_ROUTE_PREPARATION_REQUIRED response.

## Possible Solution

Redeliver the same signed fixture once only when the response has that status and code with retryable set to true. Preserve the second response and all unrelated failures.

## Minimal Reproducible Example

Return the typed retryable 503 from the first synthetic webhook request, followed by HTTP 202. The original sender rejects the first response without sending again. Also exercise two consecutive typed 503 responses to prove persistent failure remains visible.

## Context

Hosted-local Linq delivery verification must distinguish a bounded, declared retry boundary from a failed delivery assertion. No production routing or provider policy change is needed.
