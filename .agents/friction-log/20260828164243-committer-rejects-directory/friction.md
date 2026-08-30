---
title: 'Committer rejects directory paths accepted by completion workflow'
severity: 'minor'
---

## Expected Behavior

The scoped intermediate-commit path should either accept selected directories and resolve them to exact changed files, or the workflow documentation should say that every file must be enumerated.

## Current Behavior

`scripts/committer` rejects a selected directory with `directories are not allowed` even though the plan workflow describes scoped path resolution and requires an intermediate candidate commit while the plan remains active.

## Possible Solution

Share the existing exact changed-file resolver used by `scripts/finish-task`, or document the stricter intermediate-commit input contract next to the candidate-commit step.

## Minimal Reproducible Example

1. Modify two files under a synthetic `src/feature/` directory.
2. Run `scripts/committer "test: scoped candidate" src/feature`.
3. Observe that the commit is rejected until every changed file is listed separately.

## Context

A standard plan-bearing PR task needed an intermediate candidate commit before external review. The rejection forced manual enumeration of every selected file and made the documented commit path ambiguous.
