# Agent workflow docs cleanup

Status: completed
Created: 2026-03-31
Updated: 2026-03-31

## Goal

Reduce avoidable agent overhead by clarifying the mandatory read set, documenting scoped verification when repo-wide checks are already known red, explaining `scripts/finish-task`, and adding a tiny-change completion-workflow fast path.

## Scope

- split the repo doc read order into always-read versus read-if-relevant guidance
- document a scoped verification mode for narrow changes when the repo is already credibly red for unrelated reasons
- add a concise explanation of what `scripts/finish-task` does
- relax mandatory audit-pass requirements for tiny low-risk changes without removing the final review gate

## Non-goals

- changing product/runtime behavior
- changing commit tooling behavior beyond documentation
- weakening review requirements for medium/high-risk or cross-cutting changes

## Files

- `AGENTS.md`
- `agent-docs/index.md`
- `agent-docs/operations/verification-and-runtime.md`
- `agent-docs/operations/completion-workflow.md`

## Verification

- required repo checks for docs/process changes:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`

## Notes

- Keep the durable docs aligned so AGENTS summary, verification policy, and completion workflow do not contradict each other.
Completed: 2026-03-31
