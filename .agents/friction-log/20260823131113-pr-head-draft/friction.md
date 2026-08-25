---
title: 'PR head draft-reset controller cannot perform its GraphQL mutation'
severity: 'minor'
issue: 'cobuildwithus/murph#2181'
---

## Expected Behavior

After a ready pull request receives a synchronized head, the trusted controller should convert that exact current head back to draft so an operator can mark it ready and start required exact-head CI.

## Current Behavior

The read-only head-change receipt succeeds, but the trusted controller's GraphQL draft conversion is rejected as inaccessible to the workflow integration. The pull request remains ready and required ready-only workflows do not run for the new head.

## Possible Solution

Give the trusted controller an authority surface that can perform the documented draft conversion, then retain its exact repository, branch, SHA, state, and uniqueness checks.

## Minimal Reproducible Example

1. Open a repository pull request as ready.
2. Push a new exact head to its branch.
3. Observe the successful head-change receipt.
4. Observe the draft-reset controller fail at the draft conversion while the pull request remains ready.

## Context

This blocks the documented draft-to-ready exact-head CI cycle after a normal pull request update and forces an operator to perform the lifecycle manually.
