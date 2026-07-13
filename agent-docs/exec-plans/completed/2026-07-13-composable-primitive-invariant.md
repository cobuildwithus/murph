# Composable Primitive Invariant

Status: completed
Created: 2026-07-13
Updated: 2026-07-13

## Goal

- Add a baseline invariant that prefers a generic, composable primitive over a
  feature-only tool or system when the current requirement can be expressed
  through the smaller shared capability.

## Success criteria

- `docs/contracts/00-invariants.md` states the composable-primitive rule.
- The rule preserves the ban on speculative abstractions.
- The touched Markdown is read back and the scoped change is committed.

## Scope

- In scope: the baseline invariants doc and task coordination artifacts.
- Out of scope: runtime, product, test, and configuration changes.

## Constraints

- Keep the rule concise, cross-cutting, and mechanism-independent.
- Preserve unrelated working-tree and ledger edits.
- Do not include secrets, direct identifiers, or local paths in committed text.

## Tasks

1. Add the invariant under Radical Simplicity.
2. Read back the exact diff and check the wording against adjacent rules.
3. Close the plan with a scoped commit.

## Decisions

- Keep feature-specific policy at the edge and put the reusable capability at
  its owning boundary.
- Bound generalization to proven requirements so composability does not become
  permission for a speculative framework.

## Verification

- Read back the new Radical Simplicity invariant and checked it against the
  adjacent abstraction and complexity rules.
- `git diff --check -- docs/contracts/00-invariants.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  passed.
- The text-only docs fast path requires direct readback rather than repo-wide
  tests or typecheck.
Completed: 2026-07-13
