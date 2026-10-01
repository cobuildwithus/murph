# System mailbox frontier selection

Status: completed
Created: 2026-09-01
Updated: 2026-09-01

## Goal

- Make hosted system-mailbox owner selection and execution derive from the same exact first live durable frontier, stopping hot no-progress invocations when an earlier retained item has a future retry.

## Success criteria

- A future-retry durable frontier prevents a later model-free row from advertising an immediate `system_mailbox` wake.
- A later due row becomes eligible after the frontier is removed or reaches its retry boundary.
- Due default-owned work keeps its documented foreground/default ownership and is not shadowed by provider-cleanup preflight.
- A production-shaped runtime regression converges without an unrelated wake.

## Root-cause evidence

- The unfiltered wake selector scans serialization frontiers and can choose a later due model-free row.
- The bounded `system_mailbox` executor projects only the exact first live durable frontier before preparing work.
- With a future-retry device frontier and a later due maintenance row, selection advertises an immediate mailbox wake while execution prepares nothing.
- The merged provider-cleanup preflight does not touch either side of this disagreement.

## Plan

1. Add focused selector and production-shaped runtime regressions that reproduce the no-progress loop.
2. Derive model-free wake eligibility from the same durable-frontier projection used by execution while preserving default-owned priority.
3. Cover the provider-cleanup/default-owner interaction found during review.
4. Run focused tests, typecheck, complexity, diff/privacy review, commit, open a PR, merge under the user's incident authorization, deploy, certify, and prove production frontier movement.

## Verification

- `hosted-runtime-mailbox-state.test.ts`: 17 passed.
- `hosted-runtime-workspace-assistant-phase-foreground.test.ts`: 87 passed.
- Assistant scheduling, device-sync, and delegated-direction suites: 129 passed.
- Focused workspace entrypoint and preemption journeys: 6 passed.
- `pnpm --dir packages/assistant-runtime typecheck`: passed.
- `git diff --check` and the scoped privacy scan: passed.

## Review

- Selection and unfiltered execution now share one owner projection.
- Default-owned rows remain independently eligible; only later model-free rows wait behind the exact durable frontier.
- Sequence-less dense retention remains explicitly model-free.
- Due default-owned work bypasses cleanup preflight, while cleanup still precedes stale model-free handoff when no due default-owned row exists.

## Deployment concerns

- Cloudflare runtime only; persisted state and Temporal/Web wire contracts are unchanged.
- Immediate container rollout is required so warm containers stop using the mismatched selector.
- Post-deploy proof must show the affected workspace advances beyond the retained frontier and stops repeated no-progress invocations.
Completed: 2026-09-01
