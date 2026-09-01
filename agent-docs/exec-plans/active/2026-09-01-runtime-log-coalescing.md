# Hosted runtime log coalescing

Status: active
Created: 2026-09-01
Updated: 2026-09-01

## Goal

- Reduce verbose hosted runtime-log request fanout without delaying warnings, errors, invocation completion, or user-visible work.

## Success criteria

- Idle debug and info entries share one bounded coalescing window and batch through the existing request limits.
- Reaching the existing entry or serialized-body limit starts the current writer immediately.
- Invocation drain flushes queued entries immediately, while warn and error entries remain direct and awaited.
- Cross-port FIFO order, preemption barriers, queue trimming, and failed-write behavior remain unchanged.
- Focused regression tests prove the timing, bounds, drain, ordering, and failure behavior.

## Scope

- In scope: the assistant-runtime log queue owner, its comments, and focused queue tests.
- Out of scope: log schema, Web persistence, retention, warning/error policy, or another queue owner.

## Root-cause evidence

- The existing queue starts its writer immediately whenever it was idle, so isolated verbose entries each cause a request despite the batching layer.
- The queue already owns every required safety bound and invocation-end drain; request reduction requires changing only when that existing writer starts.

## Plan

1. Add one unref'd idle coalescing timer around the existing writer.
2. Start the writer early at the existing entry or body-size request bound and during invocation drain.
3. Add focused deterministic timing, ordering, bound, and failure regressions.
4. Run focused assistant-runtime proof, complexity and diff review, exact-head CI, final ReviewGPT, and merge.

## Deployment concerns

- The change is confined to the assistant-runtime package consumed by the Cloudflare runner.
- Old and new Web deployments accept the same log request schema, so no coordinated Web deployment is required.
- Rollback restores the prior immediate-start behavior without data or schema migration.

## Verification

- Passed: focused hosted runtime-log queue suite (18 tests).
- Passed: assistant-runtime package typecheck.
- Passed: cyclomatic-complexity diff; the changed queue owner has no hotspot above the threshold and maximum complexity remains bounded.
- Passed: `git diff --check` and parent inspection of the source, test, and plan diff.
- Pending: exact-head required GitHub Actions, final ReviewGPT, and merge.
