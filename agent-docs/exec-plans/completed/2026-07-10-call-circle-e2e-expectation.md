# PR 444 Call Circle E2E Expectation

Date: 2026-07-10
Status: completed
PR: #444

## Goal

Align hosted full-stack E2E tool-surface assertions with the production Call
Circle port now advertised on eligible inbound turns.

## Design

- Change only the three scenario expectations that use the shared dynamic-tool
  assertion helper.
- Reuse the helper's existing `callCircleAvailable` option; add no new helper,
  runtime gate, or test-only exception.

## Proof

- Shared hosted-local E2E support unit suite.
- Relevant static E2E test collection.
- Final ReviewGPT and PR CI on the pushed correction.

## Progress

- Clean CI proved the runner bundle and runtime port are valid, then the Codex
  image-media E2E failed because its expected list omitted the correctly
  advertised `call_circle_respond` tool.

Updated: 2026-07-10
Completed: 2026-07-10
