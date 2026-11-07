---
title: 'Web browser proof regenerates stale tracked privacy PDFs'
severity: 'minor'
issue: 'cobuildwithus/murph#4506'
---

## Expected Behavior

Running the standard Web Playwright proof from a clean checkout should leave unrelated tracked legal assets unchanged.

## Current Behavior

The smoke server's legal:pdf prerequisite updates privacy.pdf, privacy-2026-10-26.pdf and their manifest hashes on the current baseline. A focused UI task must inspect and discard these unrelated generated changes before committing or running exact-head review.

## Minimal Reproducible Example

On a clean checkout, run pnpm --dir apps/web legal:pdf, then inspect git diff --stat for apps/web/public/legal. The source policy is unchanged by the task.

## Context

Encountered while verifying the public invite renderer through the repository Playwright config. Keep generated assets synchronized with their source when the policy changes.
