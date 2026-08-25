---
title: 'PR head draft-reset controller cannot read pull-request candidates'
severity: 'minor'
---

## Expected Behavior

After a ready pull request receives a new head, the trusted workflow-run controller resolves the exact open pull request and returns it to draft.

## Current Behavior

The head-change observer succeeds and the controller mints its scoped token, but the exact candidate-list request fails with `Resource not accessible by integration`. The pull request remains ready, so the new head cannot re-enter the documented draft/ready admission cycle automatically.

## Possible Solution

Verify that the controller's GitHub App installation and minted token have repository-scoped pull-request read authority in addition to the existing draft mutation authority, and add a focused token-authority contract check.

## Minimal Reproducible Example

1. Mark a same-repository pull request ready.
2. Push a new commit to its head branch.
3. Observe the head-change receipt complete successfully.
4. Observe the draft-reset controller fail during the exact open-pull-request lookup before mutation.

## Context

This blocks exact-head CI readmission after ordinary review remediation and forces an authenticated operator to perform the normal draft/ready transition manually.
