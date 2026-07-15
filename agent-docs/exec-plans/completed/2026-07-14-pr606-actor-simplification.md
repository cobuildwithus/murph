# PR 606 Actor Admission Simplification

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

Keep late hosted inputs inside the exact active conversation actor without the
global pending scans and duplicated selectors from PR 606.

## Success criteria

- The notifier passes only exact newly staged input ids to the live turn.
- Selection admits at most one exact same-route, same-account, same-actor input
  and stops at the first different actor without advancing past it.
- The first admitted input remains the preference causal anchor.
- No new index, persisted state, manager, queue, or compatibility layer.
- Target no more than 500 production additions and 700 focused test additions;
  stop and simplify before exceeding either cap.

## Constraints

- Rebuild manually from current `main`; do not cherry-pick mixed PR 606 commits.
- Preserve pending inputs across barriers and restart.
- Keep the selector pure and shared only where the two real source owners need
  identical route/actor semantics.
- Avoid Linq provider-entry and billing files.

## Tasks

1. Reproduce the route-cursor cross-actor advance on current `main`.
2. Add exact notification ids and one bounded actor selector.
3. Replace the old unsafe strict-plus-route merge with one account/actor-aware
   selector while preserving the local route scan.
4. Run focused tests, required audits, typechecks, and final review.
5. Finish, push, open a draft PR, and run exact-head ReviewGPT with CI.

## Progress

Now:

- Exact notified ids flow through the active controller into a direct hosted
  event lookup without a transient candidate buffer, persisted index, or
  store-wide scan.
- Group route selection ignores another account, stops at the first foreign
  actor, and admits at most one same-actor input per admission.
- Local sources retain their existing refresh and route scan behind the same
  account/actor selector.
- Exact-head engine tests passed (166), hosted turn-input tests passed (11),
  the hosted workspace wake regression passed, both affected package
  typechecks passed, and completion re-audits returned zero findings.

Next:

- Reconcile the non-overlapping `main` advance, then scoped commit, push, draft
  PR, CI, and exact-head ReviewGPT.
Completed: 2026-07-14
