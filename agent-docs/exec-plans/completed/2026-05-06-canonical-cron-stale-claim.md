# Canonical Cron Stale Claim

## Goal

Prevent canonical assistant cron jobs from remaining permanently blocked when a process or hosted invocation exits after claiming a job but before finalizing it.

## Scope

- Add a small stale-claim cleanup rule for canonical cron runtime records.
- Keep the existing runtime-state schema and avoid adding new scheduler infrastructure.
- Add focused tests proving stale claims are cleared and fresh claims still block execution.

## Non-Goals

- No new hosted coordination primitive.
- No configurable lease system.
- No changes to local cron job behavior beyond existing cleanup.

## Verification

- Focused assistant-engine cron tests.
- Required package/type verification per repo workflow, unless blocked by unrelated worktree state.
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
