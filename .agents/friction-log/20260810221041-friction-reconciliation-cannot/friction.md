---
title: 'Friction reconciliation cannot open its sync pull request under the organization Actions policy'
severity: 'minor'
---

## Expected Behavior

The Friction Log workflow should open a narrowly authorized reconciliation pull request without enabling repository-wide GitHub Actions pull-request creation.

## Current Behavior

Frog opens the issue and pushes the binding commit to `frog/sync`, then the workflow fails because the repository `GITHUB_TOKEN` is not allowed to create pull requests and the organization policy prevents a repository-level override.

## Possible Solution

Use a repository-installed GitHub App with only contents, issues, and pull-request write permissions. Mint a short-lived installation token in the workflow and pass it explicitly to the pinned Frog action.

## Minimal Reproducible Example

1. Merge a public-safe pending Frog entry into the default branch.
2. Let the Friction Log workflow publish it.
3. Observe that issue creation and the `frog/sync` push succeed.
4. Observe that pull-request creation fails under the organization Actions policy.

## Context

The failure leaves the authoritative binding outside the default branch and makes every otherwise successful reconciliation run conclude red.
