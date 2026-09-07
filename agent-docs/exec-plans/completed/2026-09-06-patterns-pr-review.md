# Patterns evidence follow-up audit

Status: completed
Created: 2026-09-06
Updated: 2026-09-06

## Outcome and owner

Complete the local follow-up audit before PR admission. Keep deterministic
factor matching and evidence grades with the existing query owner. Preserve
private data, report identity, and sparse-evidence behavior.

## Evidence and changes

Three synthetic regressions reproduced: a factor day before the report window
became a false baseline; a future subjective outcome became a comparison; and
one extreme case promoted a modest typical effect from B to A.

Bound comparison dates to the factor window and derive the existing grade-A
magnitude gate from the same median used by repeated-evidence grading. No new
state, provider call, or dependency is needed.

## Product UX

Outcome: comparable dates and proportionate evidence strength.
Reaches: historical boundaries, same-day subjective outcomes, and repeated
small versus large effects. Existing strong and sparse patterns remain usable.
Proof: failing-before/passing-after histories, query typecheck, and complexity.

## Candidate verification

The complete focused query suite passes 45 tests. Query typecheck passes after
correcting a synthetic helper argument type. Complexity guard passes with no
changed hotspot above 20. Current-base merge-tree is clean. Parent audit
reviewed factor/outcome boundaries, episode independence, date assignment, and
grade strength; Product UX is Ready. No further concrete in-scope defect was
found in this pass. The PR owns subsequent exact-head CI and ReviewGPT receipts;
this plan covers the completed local candidate audit.
Completed: 2026-09-06
