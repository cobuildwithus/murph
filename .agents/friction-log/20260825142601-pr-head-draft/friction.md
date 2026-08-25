---
title: 'PR head draft reset lacks pull-request write authority'
severity: 'minor'
---

## Expected Behavior

After a ready pull request receives a new commit, the trusted head-change workflow returns that exact head to draft so an authenticated operator can mark it ready and start exact-head CI.

## Current Behavior

The head-change receipt succeeds, but the workflow-run controller's GraphQL draft-conversion call fails with `Resource not accessible by integration`. The pull request remains ready and the new head does not receive the normal exact-head CI set.

## Possible Solution

Give the narrowly scoped reset job pull-request write authority through the existing trusted workflow boundary, then retain its exact repository, branch, pull request, and head-SHA revalidation before conversion.

## Minimal Reproducible Example

1. Open a draft pull request from a same-repository branch.
2. Mark it ready and let exact-head CI start.
3. Push one additional commit to the same branch.
4. Observe the head-change receipt succeed and the draft-reset workflow fail at draft conversion.

## Context

This blocks the intended ready-state reset and requires a manual draft-to-ready cycle before the corrected head receives exact-head CI.
