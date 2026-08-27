---
title: 'Ready-only merge-candidate proof can retain a stale pull-request base SHA'
severity: 'minor'
issue: 'cobuildwithus/murph#2422'
---

## Expected Behavior

Ready-only CI should validate and test the exact GitHub merge candidate when the pull-request head is unchanged and the current base has advanced cleanly.

## Current Behavior

If the base branch advances after the last head push but before the Ready event, GitHub builds the merge candidate on the new base while the event payload can retain the older base SHA. The production runner budget job then fails its first-parent assertion before installing dependencies or running its bundle comparison.

## Possible Solution

Bind the base measurement to the already-verified merge candidate first parent, or refresh the pull-request base snapshot before admitting ready-only jobs without requiring a content change or branch rebase.

## Minimal Reproducible Example

1. Push a pull-request head while the target branch points at commit A.
2. Advance the target branch to commit B without changing the pull-request head.
3. Mark the pull request ready.
4. Observe the merge ref use B as its first parent while the job expects A from the event snapshot and exits before the measured check.

## Context

This blocks exact-head CI for an otherwise mergeable reviewed patch and encourages unnecessary head or base churn. A docs-only synchronize refresh updates the event snapshot, but that is a workaround rather than the intended CI contract.

The same pull request reproduced this twice on an unchanged reviewed head after
ready-state retriggers. In both runs, the production bundle job stopped during
the merge-candidate identity preflight, before dependency installation or
bundle assembly, while every substantive sibling host-support job passed. The
pull-request API continued to report the cached base commit even though the
generated merge ref used the newer base as its first parent. Recording this
second occurrence provides the docs-only head synchronization needed to refresh
the event snapshot without changing product behavior or rebasing the reviewed
patch again.
