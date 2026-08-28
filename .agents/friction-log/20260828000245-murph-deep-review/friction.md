---
title: 'murph-deep-review skill references removed coordination ledger'
severity: 'minor'
issue: 'cobuildwithus/murph#2481'
---

## Expected Behavior

The Murph deep-review skill preflight should reference only current
repository-owned workflow files.

## Current Behavior

The skill requires
`agent-docs/exec-plans/active/COORDINATION_LEDGER.md`, but that file no longer
exists after the coordination-ledger removal. Following the preflight therefore
produces a deterministic missing-file error before review work begins.

## Possible Solution

Remove the stale preflight item or route it to the current ownership and
worktree guidance in
`agent-docs/operations/agent-workflow-routing.md`.

## Minimal Reproducible Example

1. Read the Murph deep-review skill.
2. Follow its preflight file list in a current Murph checkout.
3. Observe that `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` cannot be
   opened and only historical removal plans remain.

## Context

This interrupted the required local deep-review preparation for a small
prompt-primary pull request.
