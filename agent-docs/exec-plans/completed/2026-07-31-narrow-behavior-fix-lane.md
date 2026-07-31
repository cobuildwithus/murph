# Add a narrow behavior-fix completion lane

Status: completed
Created: 2026-07-31
Updated: 2026-07-31

## Goal

- Propose how small, proven behavior regressions could complete without
  visual-proof and duplicate AI-review machinery when they do not change
  product, authority, persistence, API, or presentation semantics.

## Success criteria

- The proposal is semantic, conjunctive, and resistant to split-diff abuse.
- It preserves focused regression proof and exact-head PR CI.
- It distinguishes presentation proof from state-timing continuity.
- It proposes one managed browser lane per task with bounded same-lane retry.
- It is explicitly non-operative until a later approved implementation PR.

## Scope

- One point-in-time research/proposal document plus its index entry.
- No product code, CI implementation, dependency, or runtime change.
- No current workflow or review requirement changes.

## Tasks

1. Document narrow behavior-fix eligibility and escalation gates.
2. Document minimum proof, review, PR, and exact-head CI expectations.
3. Separate presentation changes from state-timing continuity.
4. Propose one-lane ReviewGPT retry limits and safe fallback.
5. Run docs readback/reference verification, commit, push, and open a proposal PR.

## Evidence

- PR #1235: five-line provider fix, 59 focused tests, and 13 green exact-head
  checks; proof-only UI was deleted, while managed-browser staging repeatedly
  failed before any model review and opened four profile windows.
- A single-window, no-ZIP ChatGPT Pro consultation was attempted but did not
  progress past managed composer staging; no model result is claimed.
Completed: 2026-07-31
