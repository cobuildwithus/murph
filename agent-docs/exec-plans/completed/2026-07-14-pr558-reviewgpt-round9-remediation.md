# PR 558 ReviewGPT Round 9 Remediation

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Preserve consumed leave evidence across route handoff and bound active-turn admission work to the selected input source.

## Success criteria

- A consumed source mailbox leave event is terminalized at the destination without applying leave or emitting effects.
- Background active-turn candidate paging contains only the selected source, including refreshed inputs.
- Focused tests, affected typechecks, CI, and a fresh exact-head ReviewGPT audit pass.

## Scope

- Linq explicit-route leave handoff, hosted assistant input selection/refresh, and focused tests.
- Excludes hosted-local stub scoping, unrelated PRs, and PR merge.

## Tasks

1. Add consumed-route leave terminalization before leave identity/mutation work.
2. Carry the selected source into active-turn frontier selection and refresh.
3. Verify, finish-plan commit, guarded-push, and rerun exact-head CI plus ReviewGPT.
Completed: 2026-07-14
