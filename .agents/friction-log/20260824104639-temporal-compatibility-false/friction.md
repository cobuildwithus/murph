---
title: 'Temporal compatibility false-fails before an accepted private run becomes visible'
severity: 'minor'
issue: 'cobuildwithus/murph#2220'
---

## Expected Behavior

After GitHub accepts an exact private workflow dispatch and returns its run id, the public controller should tolerate the bounded interval before that exact run is queryable.

## Current Behavior

The first exact-run lookup can return a transient 404. The controller immediately enters cancellation, and the required status fails even when the private reader matrix subsequently passes.

## Possible Solution

Retry only transient 404 responses for the accepted exact run id before applying the existing fail-closed polling and cancellation rules.

## Minimal Reproducible Example

Stub the dispatch endpoint to return an exact run id, make the first lookup for that id return 404, then return a completed valid run and attestation.

## Context

Repeated manual retries waste CI capacity and can misclassify a passing cross-repository compatibility proof.
