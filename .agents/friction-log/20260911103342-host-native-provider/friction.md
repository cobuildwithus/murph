---
title: 'Host-native provider egress retains a container-only DNS alias'
severity: 'minor'
---

## Expected Behavior

Hosted-local provider forwarding should reach its synthetic stub from the host-native Worker as well as from the runner container.

## Current Behavior

On non-Linux hosts the harness chooses host.docker.internal as the container alias. The Linq stub exposes this as its runner base URL, and Worker provider routing retains that hostname upstream when the configured alias is itself a local/test hostname. The host process can lack that Docker-only DNS name, so authorized provider requests fail inside Worker fetch with HTTP 500 before the stub observes them. Linux instead supplies an explicit bridge address and exercises a different routing branch.

## Possible Solution

Configure the Worker provider base with the stub host-side URL and reserve container-reachable URLs for requests that actually originate inside the container. Prove the distinction with real local forwarding; do not modify shared DNS or relax the MinIO host boundary.

## Minimal Reproducible Example

On a host where host.docker.internal resolves only inside Docker, start the canonical Linq hosted-local E2E without a host-alias override. The Web stub requests can succeed while runner-originated delivery never reaches the stub. Compare with the host-side stub URL in the Worker provider configuration.

## Context

The mismatch prevents local device and foreground scenarios from reaching the later assertions that Linux CI exercises. Mocked fetch routing tests do not verify hostname reachability.

Resolved independently by the shared host-process environment correction in PR #3254. The integration-proof branch reconciles that main change and removes its temporary per-fixture workaround.
