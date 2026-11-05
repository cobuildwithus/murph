# Accept deleted changelog entries in PR evidence

Status: completed
Created: 2026-11-05
Updated: 2026-11-05

## Outcome and cause

The changelog guard rejects truthful deletion declarations because it resolves
item IDs only from the candidate tree. Resolve actually deleted fragments from
the merge base while retaining the current registry as the primary authority.

## Scope and invariants

- Keep this in the existing changelog evidence guard; add no bypass or CI flag.
- Preserve unknown-ID and edition mismatch rejection. Do not admit entries
  introduced only on a newer base or retained unrelated historical entries.
- Validate the deleted fragment's ID/date against its canonical path.
- Documentation, tooling and tests only; no runtime, provider-input or deployment
  protocol changes. Final external review remains outside this low-risk scope.
- Record the observed friction and the new owner rule, then close and commit.

## Verification

- Focused guard suite passes 15 tests, including a real temporary Git history
  with a diverged base, deletion, retained item, malformed date and missing ref.
- Full PR-guard suite: 41 tests passed. Repository-tools typecheck, Node syntax
  checks and complexity check passed. Existing registry-parser complexity is
  unchanged; no new hotspot. Actual PR deletion declaration passed locally.
- Parent review verifies current IDs override historical IDs and Git deletion
  selection uses the merge base rather than moving-base contents.
Completed: 2026-11-05
