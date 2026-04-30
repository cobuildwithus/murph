# Land hosted assistant input parallel execution plan

Status: completed
Created: 2026-04-30
Updated: 2026-04-30

## Goal

- Land a durable parallel execution plan for implementing
  `docs/hosted-assistant-input-migration-guide.md` with Codex high subagents
  while preserving single-checkout safety.

## Success criteria

- `docs/hosted-assistant-input-parallel-execution-plan.md` captures batch
  boundaries, parallel/serial gates, exclusive write scopes, verification
  strategy, and subagent handoff expectations.
- The plan reflects high-subagent review findings.
- The diff stays docs/process-only and is committed through the plan workflow.

## Scope

- In scope:
  - One new durable planning doc under `docs/`.
  - This execution plan and matching coordination-ledger row.
  - Read-only subagent stress testing of the plan.
- Out of scope:
  - Runtime implementation.
  - Test execution beyond docs-only readback/diff checks.
  - Live architecture docs updates before implementation exists.

## Constraints

- Technical constraints:
  - No local personal identifiers or home paths in docs.
  - Do not suggest parallel write agents mutating the same checkout at once.
  - Preserve the assistant input invariant from the migration guide.
- Product/process constraints:
  - Follow docs/process-only workflow.
  - Preserve unrelated dirty tree edits.
  - Do not add this point-in-time execution plan to `agent-docs/index.md`.

## Risks and mitigations

1. Risk: The plan encourages unsafe concurrent writes in one checkout.
   Mitigation: State that parallelism is for review/test design/proposals and
   serial integration/commit.
2. Risk: The plan hides critical serial gates behind broad batch labels.
   Mitigation: Call out hot files, must-stay-serial work, and verification gates.

## Tasks

1. Spawn read-only high subagents to review parallelization.
2. Draft the parallel execution plan.
3. Verify docs readback and whitespace.
4. Close the docs-task plan and commit scoped docs.

## Decisions

- Use one integrator with serial code landing.
- Use parallel subagents for bounded review, test design, and patch proposals.
- Keep Batch 1 as the contract freeze before implementation parallelism.
- Keep `automation/reply.ts`, mailbox cursor/checkpoint semantics, and commits
  serial.

## Verification

- Commands to run:
  - Read back `docs/hosted-assistant-input-parallel-execution-plan.md`.
  - `git diff --check -- docs/hosted-assistant-input-parallel-execution-plan.md agent-docs/exec-plans/active/2026-04-30-hosted-assistant-input-parallel-plan.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Expected outcomes:
  - Touched docs are internally consistent.
  - Diff has no whitespace errors.
Completed: 2026-04-30
