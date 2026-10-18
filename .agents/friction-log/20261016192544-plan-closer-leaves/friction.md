---
title: 'Plan closer leaves a wrapped Status continuation behind after marking a plan completed'
severity: 'minor'
issue: 'cobuildwithus/murph#4178'
---

## Expected Behavior

Closing an active execution plan through `scripts/finish-task` (which calls
`scripts/close-exec-plan.sh`) rewrites the whole `Status:` paragraph to the
completed status. `PLANS.md` does not require a one-line status, so a status
wrapped over several Markdown lines should still close cleanly.

## Current Behavior

Only the first physical `Status:` line is replaced with the completed status.
The wrapped continuation lines, including the closing parenthesis, remain
underneath, so the archived plan shows a completed status followed by stale
active-status text.

## Possible Solution

Normalize the entire status paragraph (the `Status:` line plus its
continuation lines up to the next blank line or metadata field) before moving
the plan, or reject a multiline status with a clear error before the plan is
moved.

## Minimal Reproducible Example

1. Create a synthetic active plan, for example
   `agent-docs/exec-plans/active/2026-01-01-example.md`, whose header is:

   ```markdown
   # Example

   Status: active (first stage merged; second stage
   prepared locally, review and CI
   pending)
   Created: 2026-01-01
   ```

2. Close it with the repository plan closer.
3. Open `agent-docs/exec-plans/completed/2026-01-01-example.md`. The header is
   now `Status: completed` followed by `prepared locally, review and CI` and
   `pending)` on the next lines.

## Context

Seen while closing a two-stage execution plan whose status line was wrapped to
the documentation line width. The archived plan is meant to be an immutable
historical record, so the leftover text cannot simply be cleaned up after
closure, and the stale fragment makes the completed status read as
contradictory.
