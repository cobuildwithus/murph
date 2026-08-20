---
title: 'Scripted App Server suite cascades after one timed-out warm turn'
severity: 'minor'
---

## Expected Behavior

When one real App Server test times out, the suite should release or invalidate its task-owned warm process before later tests run, or stop with the original failure.

## Current Behavior

Under a heavily contended host, one long scripted-provider test can hit its timeout while the warm App Server still serves that turn. Later tests then fail with the shared process busy, and final cleanup can report a non-empty temporary directory. The cascade obscures the original timeout with many secondary failures.

## Possible Solution

On a test timeout, abort and await the active task-owned turn before the next test, or mark the shared warm process unusable and stop the file after the primary failure.

## Minimal Reproducible Example

Run the assistant-engine scripted App Server test file on a CPU-contended host until a long real-provider scenario reaches its configured timeout. Observe one timeout followed by multiple busy-process failures in otherwise unrelated cases.

## Context

This makes broad local verification noisy even when focused direct and group App Server cases pass.
