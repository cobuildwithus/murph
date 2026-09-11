---
title: 'Verification can report success while skipping required proof'
severity: 'minor'
---

## Expected Behavior

Diff and acceptance verification should execute the owners they select. Hosted process filters should select runnable tests and partition their declared file completely. Every repository Node test and cold recovery scenario should have an automatic CI owner.

## Current Behavior

The internal fast path returned before an explicitly selected CLI check. Root configuration and smoke fixture changes omitted behavioral owners, acceptance omitted repository-tool tests, three Node test files lacked automatic commands, and cold stale-invocation recovery was absent from the hosted registry. Installed Vitest also exits successfully for an unmatched title filter.

## Minimal Reproducible Example

Run the diff classifier for scripts/build-test-runtime-prepared.mjs and compose its shell output with run_test_diff: runVerifyCli is true but the old dispatcher returns first. Run Vitest with an unmatched testNamePattern: all tests can be skipped with exit status zero. Compare scripts/**/*.test.mjs with workflow run commands to find the three unowned files.

## Context

Found during the scheduler verification audit. The follow-up changes the existing selection, inventory, and verification owners and adds focused regression proof.
