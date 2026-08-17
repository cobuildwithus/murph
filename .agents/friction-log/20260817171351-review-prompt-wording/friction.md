---
title: 'Review prompt wording drift breaks unrelated required release CI'
severity: 'minor'
---

## Expected Behavior

The release coverage test should stay aligned with the checked-in ReviewGPT prompt and loop documentation when either is intentionally reworded.

## Current Behavior

The prompt now requires disclosure in the applicable risk notes, while the coverage test still requires an older exact sentence containing `also disclosed`. The loop documentation also uses singular `non-obvious surface` wording while the test requires the old plural phrase. These deterministic mismatches fail the required release aggregate for unrelated pull requests.

## Possible Solution

Assert the current stable requirement phrases, and update ReviewGPT text plus its coverage assertions in the same change when those requirements are reworded.

## Minimal Reproducible Example

Run the CLI release coverage shard against the current default branch. Its exact-prose assertions fail even though the prompt and loop documentation retain the same disclosure requirements.

## Context

A conflict-free base update inherited this mismatch and blocked an otherwise green production fix at the required-CI merge boundary.
