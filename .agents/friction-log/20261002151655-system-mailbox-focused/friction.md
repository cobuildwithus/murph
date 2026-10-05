---
title: 'System mailbox focused tests fail vault-share publication on the baseline'
severity: 'minor'
---

## Expected Behavior

The isolated assistant-runtime system-mailbox suite should pass with frozen dependencies in a fresh worktree.

## Current Behavior

Six tests fail on unmodified main at 82fa1d78bf: one model-free daily-metric case retains a recording item, and five successful dirty-ack follow-up cases observe zero acknowledgements. Their synthetic state reports that vault-share projection did not complete. The same failures occur with the unrelated checkpoint-generation correction.

## Minimal Reproducible Example

Run `pnpm exec vitest run --config packages/assistant-runtime/vitest.config.ts --no-coverage packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint-system-mailbox.test.ts -t 'drains model-free|preserves successful dirty-ack'` after `pnpm install --frozen-lockfile --prefer-offline`.

## Context

A checkpoint regression fix needs adjacent system-mailbox proof. Baseline comparison confirms these failures predate the change; resolve fixture prerequisites or the existing projection failure separately.
