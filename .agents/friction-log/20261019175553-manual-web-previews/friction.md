---
title: 'Manual Web previews need a documented monorepo archive upload'
severity: 'minor'
---

## Expected Behavior

The repository should document a reliable manual preview command for current-branch design proof when automatic branch deployments are disabled.

## Current Behavior

Deploying from the linked Web subdirectory omits the workspace lockfile and fails dependency installation. Deploying from the linked repository root without archive mode exceeds Vercel's 15000-file upload limit.

## Possible Solution

Document repository-root project linking and archive upload for preview deployments, including validation of the selected project's Web root directory. Exclude generated browser test results from uploads.

## Minimal Reproducible Example

In an installed clean worktree, use the existing Web project link and run `vercel deploy --yes` from `apps/web`, then from the repository root. A subdirectory upload lacks the workspace; an unarchived root upload exceeds the file-count limit. Root deployment with `--archive=tgz` passes file-count validation. Concurrent Playwright cleanup can also race archive traversal of `apps/web/test-results`, which is absent from `.vercelignore`.

## Context

Automatic branch deployments are disabled in the Web Vercel configuration. PR design-proof preparation therefore needs a repeatable manual preview path.
