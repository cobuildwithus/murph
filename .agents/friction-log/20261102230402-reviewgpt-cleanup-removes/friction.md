---
title: 'ReviewGPT cleanup removes round metadata before parent validation'
severity: 'minor'
issue: 'cobuildwithus/murph#4487'
---

## Expected Behavior

The parent can inspect the exact packaged review-round.json after a successful waited PR review, as required by the review loop.

## Current Behavior

The package wrapper creates round metadata in an invocation temporary directory, then removes that directory. The review tool also deletes its uploaded ZIP after response capture. The persisted response and capture identity do not retain the round metadata. Post-capture validation must rely on canonical invocation inputs and the reviewer's metadata attestation instead of reading the original JSON.

## Possible Solution

Persist a public-safe copy of the packaged round metadata beside the response capture before deleting the temporary package.

## Minimal Reproducible Example

Run a synthetic PR's canonical full-snapshot review with --wait and --response-file. After successful capture, inspect the response directory for round metadata and check the reported ZIP path. The capture remains, but the metadata and ZIP have been removed.

## Context

Observed during a schema PR's final review. Exact-turn capture, model verification and elapsed-time evidence remained available; no additional model audit was needed.
