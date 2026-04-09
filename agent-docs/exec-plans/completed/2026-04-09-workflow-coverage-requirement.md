# Workflow Coverage Requirement

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Make the repo agent workflow require a coverage-bearing verification command for edited packages/apps and a required coverage-focused subagent pass before repo code/test/config tasks are considered complete.

## Success criteria

- The durable workflow docs require `pnpm test:diff <path ...>` when it already provides truthful owner-level coverage, or the edited package/app's scoped coverage-bearing command when no such diff-aware lane exists.
- The completion workflow requires a dedicated coverage-focused subagent pass instead of an optional user-requested pass whenever that coverage-bearing verification lane applies.
- The coverage prompt matches the new required behavior and instructs the worker to use the chosen coverage command output to drive the proof work.
- Supporting workflow docs/config references stay consistent with the new requirement.

## Scope

- In scope:
  - `AGENTS.md`
  - `agent-docs/index.md`
  - `agent-docs/operations/agent-workflow-routing.md`
  - `agent-docs/operations/verification-and-runtime.md`
  - `agent-docs/operations/completion-workflow.md`
  - `agent-docs/prompts/{coverage-write,task-finish-review}.md`
  - `scripts/repo-tools.config.sh`
- Out of scope:
  - Changing package/app production code
  - Reworking the broader verification harness beyond the workflow requirement

## Constraints

- Technical constraints:
  - Preserve the existing command surface and only tighten workflow requirements around choosing truthful coverage-bearing commands.
  - Keep the coverage worker write scope narrow to tests or direct-proof scaffolding.
- Product/process constraints:
  - Keep the workflow internally consistent across routing, verification, completion, and prompt docs.
  - Preserve the repo rule that spawned required audit passes are standing-authorized by policy.

## Risks and mitigations

1. Risk: The workflow docs could contradict each other about when to use `pnpm test:diff <path ...>` versus owner-level coverage commands.
   Mitigation: Update routing, verification, completion, and prompt docs together in one change.
2. Risk: The new requirement could drift because the prompt file is not part of the guarded required-doc set.
   Mitigation: Add the coverage prompt to the repo-tools required file list in the same change.

## Tasks

1. Update the coordination ledger and open this narrow execution plan.
2. Tighten routing and verification docs so repo package/app changes must use `pnpm test:diff <path ...>` when truthful or the edited owner's scoped coverage command otherwise.
3. Tighten the completion workflow so repo code/test/config changes require a dedicated coverage-focused subagent pass whenever that owner-level coverage lane applies.
4. Update the coverage prompt to match the required pass semantics and coverage-command-driven loop.
5. Run the required verification, then complete the required coverage/final review passes and close the plan.

## Decisions

- Use the existing `coverage-write.md` prompt as the required coverage-focused pass rather than reintroducing the deleted `test-coverage-audit` prompt name.
- Keep app-only edits on `pnpm verify:acceptance` when they do not already have a truthful `pnpm test:diff <path ...>` lane and do not expose a narrower owner-level coverage script yet.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm verify:acceptance`
- Expected outcomes:
  - The docs/config change remains internally consistent and the required repo verification is either green or any unrelated blocker is documented precisely.
Completed: 2026-04-09
