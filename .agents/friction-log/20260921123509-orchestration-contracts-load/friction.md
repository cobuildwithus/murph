---
title: 'Orchestration contracts load runtime health schemas through shared constants'
severity: 'minor'
---

## Expected Behavior

The public orchestration-control entrypoint should keep runtime execution and health schema dependencies out of workflow bundles.

## Current Behavior

Importing processing-mode constants through runtime-control also loads vault-sharing helpers and their schema dependencies. A consumer that needs only mailbox lane validation can pull the same graph into a workflow.

## Possible Solution

Keep shared scalar values in an internal dependency-free leaf and expose the lane predicate through the existing orchestration entrypoint.

## Minimal Reproducible Example

Import the orchestration-control entrypoint while a module loader rejects runtime-control, vault-share, contracts, and external schema modules. The uncorrected graph reaches the rejected runtime-control module.

## Context

This is a public package import-boundary regression. Preserve the existing runtime-control exports and consumer bundle budgets.
