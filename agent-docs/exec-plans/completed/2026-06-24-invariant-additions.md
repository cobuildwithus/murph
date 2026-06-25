# Add invariant additions

Status: completed
Created: 2026-06-24
Updated: 2026-06-24

## Goal

- Add the user-supplied invariant sections to `docs/contracts/00-invariants.md`
  exactly, preserving the current invariants doc style and scope.

## Success criteria

- `docs/contracts/00-invariants.md` contains the supplied sections verbatim.
- The diff is limited to the invariant doc plus this plan/ledger closeout.
- Direct readback confirms the added sections and no identifier leakage.
- Required verification is run or any blocker is recorded.

## Scope

- In scope: text-only Markdown additions to `docs/contracts/00-invariants.md`.
- Out of scope: rewriting the supplied invariant wording, changing runtime code,
  updating unrelated docs, or opening a PR/worktree.

## Constraints

- Technical constraints: commit directly on `main` per user request; preserve
  unrelated active ledger rows.
- Product/process constraints: land the additions word for word from the user's
  supplied text.

## Risks and mitigations

1. Risk: accidentally altering the requested wording.
   Mitigation: read back the touched invariant sections before commit.
2. Risk: leaking local identifiers in docs or commit artifacts.
   Mitigation: inspect the diff before commit.

## Tasks

1. Done: Add a matching coordination-ledger row.
2. Done: Insert the supplied invariant sections into
   `docs/contracts/00-invariants.md`.
3. Done: Read back the edited doc and inspect the diff.
4. Done: Run required verification.
5. Now: Close this plan with a scoped commit.

## Decisions

- None yet.

## Verification

- Direct doc readback: passed.
- Identifier scan across touched docs/ledger: passed.
- `pnpm typecheck`: passed.
- `pnpm test:diff docs/contracts/00-invariants.md agent-docs/exec-plans/active/2026-06-24-invariant-additions.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`:
  passed.
Completed: 2026-06-24
