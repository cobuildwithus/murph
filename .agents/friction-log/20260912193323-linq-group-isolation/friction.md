---
title: 'Linq group-isolation E2E retains retired audience-classification expectations'
severity: 'minor'
---

## Expected Behavior

The composed Linq group-isolation journey should exercise the current audience contract: unknown webhook directness requires a bounded provider read, and an established group route overrides a conflicting direct flag before personal admission.

## Current Behavior

After the signed-direct ingress simplification, the journey still supplies explicit directness before any group route exists and expects a provider refresh to classify it as group. The full integration lane fails before reaching its private-workspace isolation and unregistered-participant assertions.

## Possible Solution

Use the existing unknown-audience fixture for initial canonical group discovery and a conflicting direct flag after group-route creation. Preserve all mailbox, provider-input, and final-delivery isolation assertions.

## Minimal Reproducible Example

Run the hosted-local Linq webhook scenario against the signed-direct ingress implementation. Its group-isolation case expects a thread-route response for a signed explicit-direct event without an existing group route.

## Context

This test-contract drift blocks unrelated hosted integration changes and hides the later isolation proof.
