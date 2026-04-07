# Query Projection Follow-Up Cleanup And Audits

## Goal

Apply the smallest behavior-preserving simplification left after the query projection hard cut, run the required simplify and completion audits, and make the repo workflow docs unmistakably explicit that required audit subagents are already authorized by repo policy.

## Why

- The hard cut landed the right long-term architecture, but one small internal cleanup still remains valuable before production freeze.
- The repo workflow already intends required audit subagents to run automatically, but the top-level routing docs should say that more plainly so the instruction survives local ambiguity.
- This follow-up should close the loop: smallest code cleanup, explicit policy wording, and full audit pass.

## Scope

- `packages/query/src/query-projection.ts`
- `docs/contracts/03-command-surface.md`
- `AGENTS.md`
- `agent-docs/operations/agent-workflow-routing.md`
- `agent-docs/operations/completion-workflow.md`
- `agent-docs/operations/verification-and-runtime.md`

## Non-goals

- No architectural reopening of the query projection hard cut
- No new query features or SQL-backed selector rewrite
- No changes to gateway-local ownership or tolerant-read persistence
- No unrelated cleanup in other active lanes

## Target End State

- Query projection freshness/rebuild policy is factored through one internal helper instead of repeated entrypoint logic.
- Repo workflow docs clearly state that required audit subagents are authorized by repo policy and do not require a separate explicit user ask.
- Required `simplify` and `task-finish-review` passes run against the follow-up diff, and any high-signal behavior-preserving fixes are integrated.

## Risks / Invariants

- The query projection remains the single strict persisted read/search substrate.
- `readVaultTolerant()` remains the only non-persisted tolerant scan path.
- Workflow-doc clarification must reinforce existing repo policy, not create conflicting parallel rules.
- Preserve unrelated dirty-tree edits in all active lanes.

## Verification target

- Focused package/type/test checks for the touched query surface
- Low-risk repo-internal verification for the workflow-doc changes
- Required simplify audit
- Required final completion review audit

## Planned files

- `packages/query/src/query-projection.ts`
- `packages/query/test/query.test.ts`
- `docs/contracts/03-command-surface.md`
- `AGENTS.md`
- `agent-docs/operations/agent-workflow-routing.md`
- `agent-docs/operations/completion-workflow.md`
- `agent-docs/operations/verification-and-runtime.md`

Status: completed
Updated: 2026-04-07
Completed: 2026-04-07
