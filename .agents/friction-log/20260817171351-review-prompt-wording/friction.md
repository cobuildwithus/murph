---
title: 'Review prompt wording drift breaks unrelated required release CI'
severity: 'minor'
---

## Expected Behavior

The release coverage test should stay aligned with the checked-in ReviewGPT prompt when that prompt is intentionally reworded.

## Current Behavior

The prompt now requires disclosure in the applicable risk notes, while the coverage test still requires an older exact sentence containing `also disclosed`. The deterministic mismatch fails the required release aggregate for unrelated pull requests.

## Possible Solution

Assert the current stable requirement phrase, and update prompt text plus its coverage assertion in the same change when that requirement is reworded.

## Minimal Reproducible Example

Run the focused CLI release coverage test against the current default branch. The assertion for the non-obvious affected-surface sentence fails even though the prompt retains the same disclosure requirement.

## Context

A conflict-free base update inherited this mismatch and blocked an otherwise green production fix at the required-CI merge boundary.
