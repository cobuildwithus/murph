---
title: 'Pull request draft reset lacks mutation permission'
severity: 'major'
---

## Expected Behavior

After a Ready pull request receives a new pushed head, the successful exact-head
observer receipt should let the trusted default-branch controller return only
that unchanged PR head to Draft so an agent can deliberately admit fresh CI.

## Current Behavior

The controller resolves the exact repository, branch, head, and pull request,
then its GraphQL draft mutation fails because the workflow integration cannot
write the pull request. The PR remains Ready, while expensive workflows ignore
the synchronize event and no fresh required suite starts.

## Possible Solution

Give the trusted controller the narrow pull-request write permission required
by its existing exact-head GraphQL mutation, and retain the current repository,
branch, SHA, open-state, and single-candidate checks before that mutation.

## Minimal Reproducible Example

1. Push a new commit to a Ready pull request.
2. Confirm the head-change observer records the exact synchronized SHA.
3. Let the default-branch draft-reset controller resolve the exact open PR.
4. Observe the integration permission failure at the draft mutation and the
   absence of fresh expensive CI for the synchronized head.

## Context

This forces an authenticated agent to perform a manual Draft-to-Ready cycle on
the unchanged candidate before required exact-head CI can run.
