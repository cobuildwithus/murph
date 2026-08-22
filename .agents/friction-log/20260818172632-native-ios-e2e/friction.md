---
title: 'Native iOS E2E reruns retain stale concurrency priority'
severity: 'minor'
---

## Expected Behavior

Retrying a canceled required native iOS E2E workflow should create an eligible
current-head waiter, or the repository should provide a documented supported
command that does so.

## Current Behavior

The live lane has a repository-global concurrency group with one running and
one pending job. Rerunning a canceled workflow preserves the original run's
creation priority, so a newer pending workflow cancels every retry before its
test step can start. The only discovered way to create a newer waiter for the
same exact PR head is to rerun the successful Repo Hygiene workflow and let its
`workflow_run` event create a new native workflow. That retry route is not
documented.

## Possible Solution

Provide a small trusted retry helper that reruns the exact-head Repo Hygiene
owner, or add an equally strict manual dispatch path that revalidates the PR
head and preserves the existing secret boundary.

## Minimal Reproducible Example

1. Let one native iOS live job run and queue workflows A and B behind it.
2. Observe B replace A as the single pending concurrency waiter.
3. Rerun canceled workflow A.
4. Observe A cancel again before its live test starts because B retains higher
   priority.
5. Rerun A's successful Repo Hygiene prerequisite and observe the resulting new
   native workflow become the eligible current waiter.

## Context

This blocked a reviewed production reliability fix after all other required
checks passed and caused repeated no-test cancellations during ordinary CI
recovery.
