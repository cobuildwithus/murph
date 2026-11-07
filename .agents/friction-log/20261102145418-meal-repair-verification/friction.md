---
title: 'Meal repair verification waits for a timestamp change after a read-only final batch'
severity: 'minor'
---

## Expected Behavior

The operator runner should verify completed repair contents and report count-only batch progress, including when the last batch makes no canonical changes.

## Current Behavior

The owner verifier compares the Meals snapshot timestamp with the final action receipt timestamp. An unchanged final batch can legitimately reuse an earlier projection, causing a successful repair to wait for an unrelated refresh. The runner also stays silent until an entire member finishes, making long historical passes hard to distinguish from stalled work.

## Possible Solution

Use the existing post-projection completion receipt and validate the returned names against explicit invalid/conflict skip counts. Emit only scanned, renamed and skipped counts while each batch completes.

## Minimal Reproducible Example

Seed a synthetic completed repair receipt with one renamed meal and return the correctly renamed API meal from a snapshot whose timestamp precedes the final receipt. Verification should succeed without queuing another repair or waiting for another snapshot. Separately, return a stale invalid name from a newer snapshot and confirm verification waits for the repaired content.

## Context

One-time operator verification can otherwise report false delays or timeouts after durable work has completed. No product data or identifiers are needed to reproduce this CLI behavior.
