---
title: 'ReviewGPT drops verified send-model evidence before response validation'
severity: 'minor'
---

## Expected Behavior

Concrete model evidence observed during submission remains bound to the exact accepted turn and available during completion and recovery. Model mismatches, missing identity and capability limits still fail closed.

## Current Behavior

The pinned ReviewGPT integration can verify the outgoing request model, then reject a completed response whose DOM omits response-model metadata and completes below the fallback duration threshold. The completion check receives only DOM-derived evidence. Exact-metadata export recovers the response but cannot recover the independently verified send-model evidence.

## Possible Solution

Preserve verified send-model provenance with the accepted-turn receipt and provide a validated, response-bound recovery path. Retain target, turn, attachment and response-digest checks. Do not substitute picker labels or later elapsed time for model evidence.

## Minimal Reproducible Example

Use a synthetic accepted review with a verified concrete-model send request and confirmed attachment. Return a completed exact-turn response containing the completion marker before the fallback duration threshold, without a DOM model attribute. Completion rejects the response despite request-model verification, and exact-metadata export supplies no model-attestation recovery.

## Context

The repository's final-review integration can require replacement reviews without identifying a model mismatch. No private transcripts or browser-account data are needed to reproduce the validation gap.
