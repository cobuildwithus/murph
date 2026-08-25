---
title: 'Completion audit skill references removed coordination ledger'
severity: 'minor'
issue: 'cobuildwithus/murph#2213'
---

## Expected Behavior

The completion-audit preflight should reference only current repository workflow files.

## Current Behavior

The skill requires reading `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`, but that file no longer exists and the current completion workflow says the former local audit-worker flow was removed.

## Possible Solution

Remove the stale ledger preflight step or replace it with the current ReviewGPT coordination source of truth.

## Minimal Reproducible Example

From a current Murph checkout, read the completion-audit skill and then test for the referenced active coordination-ledger path. The path is absent.

## Context

This creates a false missing-file condition while preparing a normal PR completion audit.
