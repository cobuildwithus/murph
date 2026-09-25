---
title: 'Environment handoff provider-count proof shares earlier members'' background traffic'
severity: 'minor'
---

## Expected Behavior

The Environment handoff scenario should count only the workload it has admitted while retaining its strict one-provider-request assertion.

## Current Behavior

The scenario runs after a system-mailbox fixture on a shared provider stub. Import and handoff completion do not require all earlier members' asynchronous provider work to finish. Requests from that earlier workload can arrive between the Environment scenario's baseline and final assertion.

## Possible Solution

Run the exact-count Environment scenario before any other member seeds background work. Preserve its existing assertions and the later system-mailbox proof.

## Minimal Reproducible Example

On one shared request array, capture a baseline after member A admits background work. Admit one foreground request for member B, then let member A append a delayed provider request. The global delta is two even though member B made exactly one request.

## Context

This creates an order-dependent false failure in hosted foreground-priority release verification.
