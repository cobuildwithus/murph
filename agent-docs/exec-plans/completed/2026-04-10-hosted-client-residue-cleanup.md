# Hosted Client Residue Cleanup

## Goal

Audit the remaining hosted web client-side components for low-signal residue after the server-first auth and RSC boundary work, then remove dead state or needless client-only plumbing where it materially simplifies the code without changing behavior.

## Scope

- `apps/web/src/components/hosted-onboarding/**`
- `apps/web/src/components/settings/**`
- targeted `apps/web/test/**`
- coordination/plan artifacts for this lane

## Constraints

- No route or auth contract changes unless a discovered cleanup bug requires it.
- Prefer deleting dead state, redundant hook wrappers, or low-value client glue over speculative refactors.
- Preserve unrelated worktree edits and avoid broad UI churn.

## Working Hypotheses

1. There are still a few dead or over-scaffolded client states left from the previous client-first flows.
2. The highest-value wins will be in small action controllers rather than page-level component moves.
3. Any cleanup should stay provably behavior-preserving with focused hosted-web tests plus the normal `apps/web` verify lane.
Status: completed
Updated: 2026-04-10
Completed: 2026-04-10
