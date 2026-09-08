---
title: 'Skipped GitHub job names can invalidate cross-repository Temporal proof parsing'
severity: 'major'
issue: 'cobuildwithus/murph#2807'
---

## Expected Behavior

The public release controller should distinguish successful requested proof jobs from completed/skipped jobs belonging to an inactive workflow lane, while still failing closed when any requested proof is missing or skipped.

## Current Behavior

GitHub leaves needs-output expressions uninterpolated in names of skipped jobs. The public verifier treated those inactive names as malformed before it could evaluate the successful proof jobs, and the private release mode also omitted the ordinary compatibility attestation required by the documented two-proof contract. A successful protected private release run was therefore rejected by public production admission.

## Possible Solution

Keep a secret-free contract fixture that models the exact GitHub Jobs API shape for every dispatch mode, including completed/skipped jobs with literal output expressions. Require release mode to emit both the compatibility attestation and the hosted-release attestation.

## Minimal Reproducible Example

1. Dispatch the protected private workflow in release-admission mode.
2. Let the reader matrix and hosted release attestation succeed.
3. List the run jobs through the GitHub Jobs API.
4. Observe an inactive attestation job with conclusion skipped and an uninterpolated needs-output expression in its name.
5. Pass the jobs to the public verifier and observe a malformed-proof rejection before the successful hosted-release proof is accepted.

## Context

This surfaced only in the first exact-main production admission run after the cross-repository release controller merged. Focused unit fixtures had modeled only successful proof jobs.
