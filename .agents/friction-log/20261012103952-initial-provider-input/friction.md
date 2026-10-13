---
title: 'Initial provider input measurement harness is pinned to one prior PR'
severity: 'minor'
---

## Expected Behavior

`assistant-usage-input-measurement.test.ts` measures base versus head complete first provider requests for any prompt or tool-description change when run with `MURPH_MEASURE_USAGE_INPUT=1 MURPH_USAGE_INPUT_BASE=<sha>`.

## Current Behavior

The harness copies only the base `system-prompt.ts`, catalog, and automation modules. Base prompts therefore import the head versions of sibling prompt modules such as `group-shared-freshness.ts`, so changes there are measured as zero. The `groupAvailable` fixture also always uses the head prompt and config for both phases, and asserts PR-specific freshness enum facts that fail for any other base.

## Possible Solution

Materialize base copies of every changed prompt-owner module under the assistant source tree (or diff `git diff --name-only <base>` to choose them), always build the base phase from base modules, and move PR-specific assertions out of the shared harness.

## Minimal Reproducible Example

Change only text in `packages/assistant-engine/src/assistant/group-shared-freshness.ts`, then run the opt-in measurement against `origin/main`. Direct and group captures report identical prompt bytes for base and head, and the `groupAvailable` case fails its enum assertions.

## Context

Required PR evidence for prompt changes needs a complete base/head capture. A local uncommitted variant of the harness was needed to measure a group prompt change.
