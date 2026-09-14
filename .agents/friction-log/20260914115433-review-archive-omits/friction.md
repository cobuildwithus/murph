---
title: 'Review archive omits imported supplement script owners'
severity: 'minor'
---

## Expected Behavior

A full PR review archive for the supplement repair-preview script should include its directly imported normalization owner and the local script dependencies of its focused integration test.

## Current Behavior

The changed repair-preview source and its test are attached, but the default archive omits the unchanged label, refetch-preview and OCR-preview modules under the skill scripts directory. Final review correctly stops because the composed candidate-admission path lacks its normalization owner.

## Possible Solution

For this review, add the three exact same-head script paths through COBUILD_AUDIT_CONTEXT_ALWAYS_PATHS. Consider explicit dependency closure for changed skill-owned code in the archive owner.

## Minimal Reproducible Example

Package a PR changing .agents/skills/research-supplements/scripts/supplement-db-brand-site-repair-preview.mjs with the normal full PR preset and inspect the archive for its imported supplement-db-brand-site-labels.mjs source.

## Context

Discovered while reviewing a behavior-preserving ordered-rule refactor. The integration tests and typecheck pass locally; the missing archive evidence invalidates the external review, not the implementation.
