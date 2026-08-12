---
title: 'ReviewGPT PR presets omit inferred PR URL and preliminary phase'
severity: 'minor'
---

## Expected Behavior

After the PR-head preflight passes in a clean PR worktree, the documented `pnpm review:gpt completion-specialists` command should resolve the associated pull request and package `review-phase.json` with the `preliminary_specialists` phase automatically.

## Current Behavior

Without an explicit `REVIEW_GPT_PR_URL`, the specialist preset creates a generic package without the required PR context. Adding only that URL still packages final-round metadata because the preset does not set the preliminary phase. The review therefore returns `SPECIALIST_OUTCOME: INVALID` until both `REVIEW_GPT_PR_URL` and `REVIEW_GPT_REVIEW_PHASE=preliminary` are supplied manually.

## Possible Solution

Have the PR-only preset resolve the same branch-associated PR as the preflight and set its phase from the selected preset. Add a regression that inspects the packaged context for both PR-only presets.

## Minimal Reproducible Example

1. In a clean pushed PR branch, run `scripts/review-gpt-pr-head-preflight.sh <pr-number>`.
2. Run `pnpm review:gpt completion-specialists --wait --response-marker SPECIALIST_REVIEW_COMPLETE --response-file audit-packages/specialists.md --prompt "Review the exact PR head."`.
3. Inspect the guarded attachment: required PR context is absent.
4. Retry with only `REVIEW_GPT_PR_URL=<pr-url>`: the attachment contains final-round metadata instead of preliminary-specialist phase metadata.

## Context

This forces multiple long-running invalid review attempts before the substantive preliminary pass can begin.
