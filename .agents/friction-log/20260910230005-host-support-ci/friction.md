---
title: 'Host Support CI contract still expects CLI-only runtime preparation'
severity: 'minor'
---

## Expected Behavior

The Host Support policy proof should require built runtime preparation for both CLI and Assistant Engine coverage shards while keeping package-shape verification exclusive to the CLI shard.

## Current Behavior

The workflow correctly prepares runtime artifacts for both shards, but its policy test still expects two CLI-only guards. Only the package-shape step remains CLI-only, so the assertion rejects the current workflow and blocks Repo Hygiene and dependent Temporal compatibility admission.

## Possible Solution

Bind each step's guard to its command in the policy assertions. Require the shared CLI-or-Assistant-Engine guard for runtime preparation and one CLI-only guard for package-shape verification.

## Minimal Reproducible Example

1. Use a checkout whose Host Support runtime-preparation step admits CLI and Assistant Engine shards.
2. Run `node --test scripts/pull-request-ci-policy.test.mjs`.
3. Observe the obsolete two-guard assertion fail against the current workflow.

## Context

A workflow prerequisite correction left its static policy assertion stale. Unrelated pull requests inherit the failure after reconciling main. Update the workflow and its executable policy proof together.
