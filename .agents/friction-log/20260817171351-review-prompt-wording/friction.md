---
title: 'Review prompt wording drift breaks unrelated required release CI'
severity: 'minor'
---

## Expected Behavior

The release coverage test should stay aligned with the checked-in ReviewGPT workflow documentation when wording or requirement ownership changes.

## Current Behavior

Recent workflow simplification reworded ReviewGPT requirements and moved Product UX requirements to their current owners, while the coverage test retained several old exact phrases and owner assumptions. These deterministic mismatches fail the required release aggregate for unrelated pull requests.

## Possible Solution

Assert stable requirement phrases against their current owning documents, and update ReviewGPT text plus its coverage assertions in the same change when wording or ownership changes.

## Minimal Reproducible Example

Run the CLI release coverage shard against the current default branch. Its exact-prose assertions fail even though the prompt and loop documentation retain the same disclosure requirements.

## Context

A conflict-free base update inherited this mismatch and blocked an otherwise green production fix at the required-CI merge boundary.
