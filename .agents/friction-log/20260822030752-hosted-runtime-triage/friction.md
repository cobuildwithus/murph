---
title: 'Hosted runtime triage skill references retired repo paths'
severity: 'minor'
issue: 'cobuildwithus/murph#2169'
---

## Expected Behavior

The hosted-runtime triage skill should route investigators only to current
repository-owned runtime and coordination documents.

## Current Behavior

The skill requires `packages/hosted-orchestrator-temporal/README.md` and
`agent-docs/exec-plans/active/COORDINATION_LEDGER.md`, but neither path exists
in the current repository. The investigator must stop and search for replacement
owners before continuing.

## Possible Solution

Update the skill to reference the current Temporal ownership document and
current coordination mechanism, or mark those reads conditional when no
repository-owned replacement exists.

## Minimal Reproducible Example

1. Start a hosted-runtime failure investigation.
2. Follow the skill source order.
3. Attempt to read both required paths.
4. Observe that both are absent from the checkout.

## Context

This interrupted a time-sensitive hosted assistant reply investigation but did
not block production root-cause proof.
