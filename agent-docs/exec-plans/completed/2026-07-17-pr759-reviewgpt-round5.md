# PR 759 ReviewGPT round 5 remediation

Status: completed
Created: 2026-07-17
Updated: 2026-07-17

## Goal

- Resolve the accepted ReviewGPT round-4 review-induced finding: a suppressed saved outcome must not own the projected windows of a stopped run.

## Success criteria

- Saved outcome windows inform only the early-stop decision; once suppressed, the projected stopped-run windows derive from the live run plan clamped to canonical `endedOn`.
- A surviving saved outcome still supplies its windows for finished runs; runs without a saved outcome keep existing live behavior.
- Regressions with deliberately divergent saved/live boundaries prove pre-stop evidence is bucketed by live boundaries and post-stop evidence stays excluded, at both the query and web boundaries.
- Base merge with `main` is clean; the writer-path runtime test respects the new planned-only protocol-lineage guard.
- Focused/full verification, audits, exact-head CI, and ReviewGPT round 5 are green.

## Scope

- In scope: `buildRunContext` window ownership in the browser query, matching query/web regressions, runtime writer-test adaptation to the main-side lineage guard, PR contract updates.
- Out of scope: outcome persistence, lifecycle mutation rules, new state or compatibility machinery.

## Review finding and decision

- Accept the round-4 finding as production-reachable: `updateExperiment` may edit the live run plan while retaining `outcomeRef` and `endedOn`; the round-4 code projected saved windows (clamped) even after suppressing the outcome, so a boundary-date measurement could be attributed to the wrong phase in the stopped view.
- Continue redesign-by-deletion: one decision input (saved planned end), one projection source (live windows clamped to `endedOn`), no new state.

## Verification

- Failing-first query regression with divergent boundaries; web timeline regression; full focused `pnpm test:diff` lane over the touched owners.
- Required audit re-checks, exact-head CI, and ReviewGPT round 5.
Completed: 2026-07-17
