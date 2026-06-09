# Worktree PR Default

## Goal

Update Murph agent workflow policy so most non-trivial repo changes default to an isolated git worktree, task branch, and PR, while preserving a direct-current-checkout path for minor edits.

## Constraints

- Keep `AGENTS.md` compact and route-oriented.
- Keep `agent-docs/operations/agent-workflow-routing.md` as the durable workflow source.
- Preserve unrelated dirty working-tree and ledger edits.
- Do not create a new worktree or branch for this policy-doc edit.

## Working Set

- `AGENTS.md`
- `agent-docs/operations/agent-workflow-routing.md`
- `agent-docs/index.md`

## Verification Plan

- Read back touched Markdown.
- Run `pnpm typecheck` per the low-risk docs/process tooling fast path.
Status: completed
Updated: 2026-06-09
Completed: 2026-06-09
