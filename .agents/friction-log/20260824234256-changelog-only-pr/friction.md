---
title: 'Changelog-only PR skips the preview required for current design proof'
severity: 'minor'
issue: 'cobuildwithus/murph#2252'
---

## Expected Behavior

A pull request that changes an `apps/web/changelog/entries` fragment should either receive a reviewer-openable Web preview or have a documented proof route that does not require a current preview.

## Current Behavior

The Vercel integration can mark the deployment ignored when the only hosted Web change is a changelog fragment, while the completion workflow still requires a current reviewer-openable design representation for every user-facing hosted Web diff.

## Possible Solution

Treat changelog fragments as preview-relevant inputs, or document a narrow changelog-content proof path that reuses the server-rendered archive study without requiring a branch preview.

## Minimal Reproducible Example

1. Add one valid JSON fragment under `apps/web/changelog/entries/<date>/`.
2. Push the draft pull request without changing a Web component.
3. Observe that the Vercel status succeeds as an ignored deployment and supplies no branch preview URL.

## Context

This blocks current-branch visual review of an otherwise valid changelog item and forces agents to choose between starting the full hosted Web environment or reporting a browser-proof gap despite focused archive rendering tests.
