---
title: 'Complexity guard rejects exact function extraction as new debt'
severity: 'minor'
---

## Expected Behavior

Moving an unchanged function to its responsibility owner should retain the existing complexity baseline while new or modified functions remain subject to the debt and maximum ratchets.

## Current Behavior

The guard compares each changed file independently. An extracted function above the threshold creates positive destination debt even when the source loses exactly the same function and repository behavior is unchanged.

## Minimal Reproducible Example

Commit source.ts containing a function with 21 independent if statements and a second retained function. Move only the first function unchanged into owner.ts, importing it from source.ts. Run pnpm complexity:diff against the initial commit. The new file fails with debt 2 and maximum 22 despite the corresponding removal.

## Context

This blocks responsibility extraction PRs and encourages unrelated rewrites solely to satisfy file placement accounting. Exact removed/added function matching must consume each occurrence once and must not excuse copies or changed bodies.
