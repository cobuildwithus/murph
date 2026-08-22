---
title: 'Prisma format rewrites unrelated schema layout during focused validation'
severity: 'minor'
---

## Expected Behavior

The documented focused Prisma validation path should validate the schema without mechanically rewriting unrelated model layout, or it should clearly separate validation from formatting.

## Current Behavior

Running the formatter while validating a focused schema change rewrites a large unrelated portion of the schema. The resulting diff obscures the task-authored migration work and requires a careful bounded restore before review.

## Possible Solution

Use validation-only commands in focused completion guidance, and reserve schema formatting for intentional repository-wide formatting changes. Consider adding a guard that warns when formatting changes exceed the staged schema surface.

## Minimal Reproducible Example

1. Start from a clean task worktree with a focused Prisma schema change.
2. Run the repository Prisma formatter as part of validation.
3. Inspect the schema diff and observe unrelated layout rewrites outside the focused change.
4. Restore the unrelated formatter output and run Prisma validation without formatting.

## Context

This adds review noise and creates a risk that mechanical schema churn is accidentally committed with a narrow database compatibility change.
