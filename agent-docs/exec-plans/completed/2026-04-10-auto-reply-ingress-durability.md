# 2026-04-10 Auto-Reply Ingress Durability

## Goal

Land the clean long-term auto-reply architecture seam:

- assistant automation remains a persisted-capture consumer
- assistant auto-reply channel state reconciliation is shared instead of reimplemented per caller
- `inbox source add --enableAutoReply` actually updates assistant runtime state in the default CLI path
- the event-driven loop wakes correctly for opted-in self-authored traffic
- docs describe Telegram, email, and Linq durability honestly

## Success Criteria

- One shared assistant-owned helper reconciles managed auto-reply channels and cursor seeding.
- CLI source-add auto-reply enablement uses a real implementation instead of the current default no-op.
- Setup and hosted runtime use the shared helper rather than local duplicated reconciliation logic.
- Continuous assistant automation wakes on self-authored imports when `allowSelfAuthored` is enabled.
- Architecture text explicitly distinguishes Telegram backlog polling, email unread backlog, and Linq webhook-only delivery.

## Constraints

- Preserve overlapping iMessage decommission, scheduler, hosted auth, and route-estimate work already in the tree.
- Do not introduce new package dependency cycles.
- Keep assistant automation transport-agnostic; do not move transport durability into the scheduler.

## Planned Verification

- `pnpm typecheck`
- truthful scoped tests for touched owners, likely `pnpm test:diff ...` if coverage-bearing for the slice
- required completion-workflow audit passes after implementation stabilizes
Status: completed
Updated: 2026-04-10
Completed: 2026-04-10
