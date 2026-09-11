---
title: 'Delayed PR draft reset can erase a newer Ready decision for the same head'
severity: 'minor'
issue: 'cobuildwithus/murph#3211'
---

## Expected Behavior

After an author finishes verification and marks the current PR head Ready, full CI should start for that head and remain eligible for completion.

## Current Behavior

Pushing while a PR is Ready queues the head-change receipt and its separate workflow-run draft reset. An immediate ready command can report that the PR is already Ready, producing no ready_for_review event for the new head. The delayed reset then converts that same head to Draft even though the author has already made a readiness decision. Queue delays add an unbounded wait before the author can safely restore readiness, and the broad workflows only run on opened, reopened, or ready_for_review.

## Possible Solution

Keep readiness ownership explicit. At minimum, document and automate marking a PR Draft before a new push, then Ready after focused verification. Prefer eliminating the delayed controller's ability to overwrite a newer author readiness decision.

## Minimal Reproducible Example

1. Mark an owned test PR Ready.
2. Push a small documentation follow-up while it remains Ready.
3. Immediately run gh pr ready for that PR; it can report already ready.
4. Let the queued Pull Request Head Change and Pull Request Head Draft Reset workflows finish.
5. Observe the PR becoming Draft and the final head lacking the broad ready-triggered checks until another Ready transition.

## Context

This delays completion of an otherwise verified change and makes an ordinary push-then-ready sequence race with repository automation. Marking Draft before the next push avoids creating a fresh reset receipt.
