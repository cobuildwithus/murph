# Audit subagent reasoning defaults

Status: completed
Created: 2026-06-02
Updated: 2026-06-02

## Goal

- Update the durable agent workflow docs so required local Codex workflow audit subagents default to high reasoning, and use xhigh reasoning for large or complex changes.

## Success criteria

- `agent-docs/operations/completion-workflow.md` records the high/xhigh reasoning default for required audit subagents.
- Routing summaries and any conflicting audit prompt instructions no longer require medium reasoning for workflow audits.
- Touched Markdown docs are read back successfully.
- The plan is closed and included in a scoped commit.

## Scope

- In scope: workflow routing docs, completion workflow docs, audit prompt metadata/instructions, plan/ledger bookkeeping.
- Out of scope: changing app/package runtime behavior, changing audit prompt scope beyond reasoning effort, running any workflow audit subagents for this docs-only task.

## Constraints

- Technical constraints: text-only Markdown update; preserve unrelated dirty worktree files.
- Product/process constraints: follow docs/process-only ledger and plan workflow; no required audit subagents for this docs-only task.

## Risks and mitigations

1. Risk: leaving a conflicting `medium reasoning` instruction in a prompt or routing summary.
   Mitigation: search workflow docs and prompts for reasoning references and update the conflicting text.

## Tasks

1. Add the high/xhigh audit reasoning default to the completion workflow.
2. Align routing summaries and the `coverage-write` prompt with the new default.
3. Read back touched docs and close the plan with a scoped commit.

## Decisions

- Keep `coverage-write` pinned to `gpt-5.5`, but change its reasoning effort from medium to the workflow audit default.
- `scripts/finish-task` closed the plan and removed the ledger row, but the final scoped commit uses `scripts/committer` because the helper moved the active plan before staging the active-plan target.

## Verification

- Passed:
  - Direct readback of `agent-docs/operations/completion-workflow.md`, `agent-docs/operations/agent-workflow-routing.md`, and `agent-docs/prompts/coverage-write.md`.
  - `rg -n "medium reasoning|medium-reasoning|high reasoning|xhigh reasoning|workflow audit reasoning" agent-docs/operations agent-docs/prompts AGENTS.md`
  - `git diff --check -- agent-docs/operations/completion-workflow.md agent-docs/operations/agent-workflow-routing.md agent-docs/prompts/coverage-write.md agent-docs/exec-plans/active/2026-06-02-audit-subagent-reasoning-defaults.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff agent-docs/operations/completion-workflow.md agent-docs/operations/agent-workflow-routing.md agent-docs/prompts/coverage-write.md`
Completed: 2026-06-02
