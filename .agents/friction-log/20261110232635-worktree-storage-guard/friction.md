---
title: 'Worktree storage guard hides the failing filesystem probe during concurrent checkout changes'
severity: 'minor'
---

## What happened
The scoped committer stopped because the shared storage guard received a nonzero status from its batch df probe. A later read-only probe over the current registered paths succeeded; the registered-path inventory had changed between checks. No unrelated worktree was modified.

## Expected behavior
Report a secret-safe identifier for the failed probe and distinguish a vanished path during concurrent retirement from unavailable storage, so an authorized checkout owner can diagnose a retry without bypassing the guard.

## Repository evidence
In scripts/worktree-storage-guard, count_record collects disk paths before the later batch df invocation. The invocation suppresses stderr and only reports the total path count on failure. A synthetic concurrent-removal fixture can exercise that interval without touching real checkouts.

## Impact
An otherwise verified commit needs extra read-only diagnosis and a normal retry. Preserve the existing fail-closed capacity and authorization checks.
