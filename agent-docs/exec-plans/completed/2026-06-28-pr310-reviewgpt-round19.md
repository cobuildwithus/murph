# PR 310 ReviewGPT Round 19

## Goal

Resolve the accepted PR 310 ReviewGPT round 19 findings with the smallest durable
change:

- Preserve delivery-owned `message.failed` alerts when the specific delivery
  receipt advanced, even if the line-level receipt projection is stale.
- Remove stale GitHub-connector hard-stop language from the artifact-based PR
  ReviewGPT prompt and cover the intended prompt/config contract.

## Constraints

- Keep line current-state ordering and stale delivery receipt suppression intact.
- Do not add a new state owner, queue, reconciliation loop, lifecycle, or policy
  abstraction.
- ReviewGPT findings are evidence to verify, not implementation ownership.

## Plan

1. Add a focused regression for line-stale but delivery-advanced failed receipt
   alert claiming.
2. Narrow `ingestHostedLinqProviderEventTx` so line receipt staleness does not
   suppress delivery-owned alerts when the delivery receipt advanced.
3. Delete the stale GitHub connector hard-stop sentence from the PR review
   preset and assert it stays absent.
4. Run focused verification, commit, push, and rerun ReviewGPT if needed.

Status: completed
Updated: 2026-06-28
Completed: 2026-06-28
