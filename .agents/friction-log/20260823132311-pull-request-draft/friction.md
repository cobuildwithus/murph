---
title: 'Pull request draft reset controller lacks permission to convert exact-head PRs'
severity: 'minor'
issue: 'cobuildwithus/murph#2180'
---

## Expected Behavior

After a same-repository ready pull request receives a synchronized head, the exact-head receipt should let the workflow-run controller return that pull request to draft so a later Ready action launches expensive CI on the new head.

## Current Behavior

The exact-head receipt succeeds, but the draft-reset controller fails at the GraphQL draft-conversion mutation with GitHub's "Resource not accessible by integration" response. The pull request remains ready and the expensive exact-head workflows do not launch for the synchronized head.

## Possible Solution

Give the workflow-run controller the minimum pull-request write permission or installation-token scope required by the draft-conversion mutation, while retaining its exact repository, branch, SHA, and single-candidate checks.

## Minimal Reproducible Example

1. Open a same-repository pull request and mark it ready.
2. Push a docs-only commit to the pull-request branch.
3. Observe the head-change receipt succeed for the exact SHA.
4. Observe the draft-reset workflow fail at the conversion mutation and the pull request remain ready without new expensive CI.

## Context

This blocks the documented final-plan-closure flow from proving required CI on the final exact head and forces a manual draft-to-ready recovery.
