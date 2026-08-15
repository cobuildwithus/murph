---
title: 'Dependency audit does not distinguish unchanged advisory backlog'
severity: 'minor'
---

## Expected Behavior

A dependency-only update should have a deterministic audit check that identifies advisories introduced or worsened by the candidate lockfile while still reporting the existing repository backlog.

## Current Behavior

`pnpm deps:audit` exits unsuccessfully on the full existing high and critical advisory set. A three-file package bump with no transitive lockfile changes therefore requires a manual baseline comparison to prove that the candidate introduced no advisory or vulnerable version.

## Possible Solution

Add a committed audit baseline or a lockfile-aware comparison mode that fails only for new or worsened findings while keeping the complete report visible for remediation.

## Minimal Reproducible Example

1. Start from the current protected branch.
2. Update one direct development dependency between releases whose transitive lock entries are unchanged.
3. Run `pnpm deps:audit`.
4. Observe that the command fails on the unchanged advisory backlog without identifying the candidate delta.

## Context

This makes narrow supply-chain updates slower to validate and easier to misclassify, even when the manifest and lockfile prove no transitive dependency changed.
