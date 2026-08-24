---
title: 'PR head draft-reset controller cannot convert pull requests'
severity: 'minor'
---

## Expected Behavior

After a non-draft pull request receives a new head commit, the trusted default-branch controller converts that exact unchanged pull request back to draft so an authenticated operator can mark it Ready and launch expensive exact-head CI once.

## Current Behavior

The synchronize receipt succeeds and the controller resolves the exact open pull request, branch, repository, and head SHA, but GitHub rejects the `convertPullRequestToDraft` GraphQL mutation as inaccessible to the workflow integration. The pull request remains Ready, while expensive workflows intentionally ignore `synchronize`, so the new head receives no broad CI until an operator manually performs the Draft-to-Ready cycle.

## Possible Solution

Give the trusted controller a credential that can perform the draft mutation, or replace the GraphQL mutation with a supported authenticated boundary whose permission is covered by focused workflow tests.

## Minimal Reproducible Example

1. Start with an open non-draft pull request.
2. Push one additional commit to its head branch.
3. Observe the read-only head-change receipt succeed.
4. Observe the trusted draft-reset controller resolve the exact pull request and fail at the draft conversion mutation.
5. Confirm the pull request remains non-draft and the Ready-only broad workflows do not run for the new head.

## Context

This blocks the repository's documented near-merge Ready gate and requires an authenticated operator to reproduce the intended Draft-to-Ready transition before exact-head CI can run.
