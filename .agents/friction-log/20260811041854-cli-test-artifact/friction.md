---
title: 'CLI test artifact repair lock outlives a timed-out worker'
severity: 'minor'
---

## Expected Behavior

Diff-aware CLI verification should prepare or repair required runtime artifacts once, clean up its lock on worker failure, and let later CLI tests either run or report the actual preparation error.

## Current Behavior

When a CLI test worker times out during runtime-artifact repair, an empty `node_modules/.cache/murph/cli-runtime-artifacts.lock` directory can remain. Later unrelated CLI subprocess tests wait 60 seconds on that lock, exactly consume their 60-second test timeout, and report only generic timeouts. Removing the exact empty lock and running `pnpm build:test-runtime:prepared` makes the same focused test pass in seconds.

## Possible Solution

Prepare CLI runtime artifacts once before the diff-aware CLI test phase, make lock ownership recoverable when a worker exits, or ensure lock-wait failures surface before the enclosing test timeout.

## Minimal Reproducible Example

1. Start `pnpm test:diff` for a diff that reaches source-first CLI tests while prepared CLI runtime artifacts are absent.
2. Let the artifact-repair worker time out or terminate before cleanup.
3. Run a subprocess-backed CLI test and observe a 60-second test timeout with an empty repair-lock directory still present.
4. Remove only that empty lock, run `pnpm build:test-runtime:prepared`, and rerun the same test; it completes normally.

## Context

This turns one artifact-preparation failure into repeated one-minute timeouts across unrelated CLI test files and obscures the actionable cause during required PR verification.
