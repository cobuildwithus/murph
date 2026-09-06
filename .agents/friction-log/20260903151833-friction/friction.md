---
title: 'Temporal proof-format fixes can cross and red every relevant PR'
severity: 'major'
issue: 'cobuildwithus/murph#2786'
---

## Expected Behavior

Public and private Temporal compatibility changes should preserve one versioned cross-repository proof format and land in an order that keeps the required exact-head status usable.

## Current Behavior

The private controller restored the documented SHA-only reader digest, while a later public controller change from an older assumption began requiring a legacy-state suffix. Private reader jobs and their attestation succeed, but the public controller rejects the exact proof and every Temporal-relevant pull request remains red.

## Possible Solution

Add a secret-free cross-repository contract fixture or protected rollout proof that exercises the public verifier against the exact private attestation format before either side of the contract reaches its default branch.

## Minimal Reproducible Example

1. Run required Temporal compatibility for a relevant public pull request.
2. Observe the private workflow complete all reader jobs and publish one SHA-only attestation.
3. Observe the public controller recompute only legacy-state-suffixed candidates and reject the successful exact-run proof.

## Context

This blocked otherwise valid exact-head CI on multiple public pull requests and requires a default-branch bootstrap correction because candidate code is intentionally excluded from the trusted controller.
