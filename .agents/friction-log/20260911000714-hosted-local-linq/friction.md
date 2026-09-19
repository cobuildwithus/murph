---
title: 'Hosted local Linq Worker uses a Docker-only upstream hostname'
severity: 'minor'
---

## Expected Behavior

The composed provider-egress-token-bridge journey reaches the strict synthetic Linq HTTP upstream through the real host Worker while runner containers retain canonical HTTPS provider routes and sentinel credentials.

## Current Behavior

On macOS the full-stack scenario normalizes the Docker host alias only for Web. The host Worker receives the unnormalized alias. A bounded actual journey observes authenticated Web chat/read requests but no runtime send or cleanup HTTP request. Native Workerd reaches the same synthetic server through loopback but cannot resolve the Docker alias.

## Minimal Reproducible Example

Run pnpm hosted-local e2e provider-egress-token-bridge with the normal isolated local Temporal worker and synthetic providers on macOS. Compare the generated host Web and Worker Linq base URL host classes. Use native Workerd to fetch a local synthetic server through each hostname.

## Possible Solution

Apply the existing scenario-owned host URL normalization before both host processes receive their environments. Preserve the container environment owner's canonical provider URL and sentinel credential projection.

## Context

This prevents local composed verification from failing before the production credential bridge reaches the strict upstream contract. Linux deployment gates use a different host alias mapping and can pass despite this local harness defect.
