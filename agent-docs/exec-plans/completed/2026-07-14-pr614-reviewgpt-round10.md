# PR 614 ReviewGPT Round 10

## Goal

Remove unsafe incoming-newer event reconstruction so suffix loss can never
resurrect provider state over a later manual edit or tombstone, or assign one
lifecycle revision to multiple accepted members.

## Evidence

- ReviewGPT completed a valid Pro-model review of `43416c4e3b` with the guarded
  ZIP and `REVIEW_COMPLETE` marker.
- A contiguous surviving prefix proves only the rows currently visible; it
  cannot prove that a lost suffix contained no later owner mutation.
- Multiple stored-proven incoming-newer members independently read the same
  pre-repair maximum and can select the same lifecycle revision.
- Both findings were reproduced on the merged head with public-boundary,
  whole-vault byte-stability tests before the production fix.
- The fix deletes incoming-newer reconstruction and retains only uniquely
  anchored historical repair. It adds no durable receipt or owner state.
- Focused regression tests, all 161 device-import tests, the TypeScript 7 core
  typecheck, scenario integrity, and core coverage all pass. Security/privacy
  and coverage-write completion audits returned zero findings and zero edits.

## Plan

1. Add failing regressions for lost edit/tombstone suffix authority and sibling
   incoming-newer revision collision.
2. Delete incoming-newer max-plus-one reconstruction and reject that shape
   before persistence; keep only exact-proof historical repair with a surviving
   stored-proven anchor.
3. Preserve valid anchored historical repair and all user-edit, tombstone,
   sample-only, role, and association controls.
4. Run merged-head focused and full verification plus required completion
   audits.
5. Close the plan, commit, push, update the PR, and merge after CI. The user
   explicitly waived another ReviewGPT round because the available review cap
   is exhausted; Round 10 remains the final managed review.

## Invariants

- Visible prefix completeness is never treated as proof that a lost suffix had
  no later canonical owner mutation.
- Stored provider evidence cannot overwrite or compact a lost manual edit or
  tombstone.
- No two records in one event spine share a lifecycle revision.
- The fix adds no persisted receipt, state, dependency, service, queue, owner,
  or compatibility layer.

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
