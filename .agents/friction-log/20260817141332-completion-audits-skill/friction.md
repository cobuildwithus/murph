---
title: 'Completion-audits skill requires a removed coordination ledger'
severity: 'minor'
---

## Expected Behavior

The completion-audits skill should route agents only to current completion workflow sources.

## Current Behavior

Its preflight requires reading `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`, but that file was intentionally removed. Agents must search history to determine the instruction is stale before continuing.

## Possible Solution

Remove the ledger preflight step from the skill or point it at the current workflow owner.

## Minimal Reproducible Example

1. Open `.agents/skills/murph-completion-audits/SKILL.md`.
2. Follow preflight step 4 in a current checkout.
3. Observe that the required active ledger does not exist.

## Context

This creates avoidable uncertainty during a required PR completion audit.
