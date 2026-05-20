# Restrict DBHub to production database debugging

Status: completed
Created: 2026-05-20
Updated: 2026-05-20

## Goal

- Make `AGENTS.md` explicit that DBHub MCP is production-only and should not be used for local development database debugging.

## Success criteria

- `AGENTS.md` tells agents to use the local `DATABASE_URL` or repo-local tooling for local database debugging.
- No secrets, local identifiers, or local paths are introduced.
- Touched Markdown is read back after the edit.

## Scope

- In scope: one routing note in `AGENTS.md`.
- Out of scope: runtime code, database tooling changes, and hosted execution behavior.

## Constraints

- Technical constraints: keep the rule short and route-oriented.
- Product/process constraints: preserve unrelated working-tree edits and existing active ledger rows.

## Risks and mitigations

1. Risk: The note could imply local database debugging is unsupported.
   Mitigation: Explicitly point agents to local `DATABASE_URL` and repo-local tooling.

## Tasks

1. Done: Update the DBHub note in `AGENTS.md`.
2. Done: Read back the touched Markdown.
3. Done: Run required verification and close the plan.

## Decisions

- Keep the rule in `AGENTS.md` because it changes agent routing behavior.

## Verification

- Commands to run: direct Markdown readback; `pnpm typecheck` unless blocked by unrelated worktree state.
- Result: direct Markdown readback passed; `pnpm typecheck` passed.
Completed: 2026-05-20
