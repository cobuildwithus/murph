# Document hosted assistant input decoupling architecture

Status: completed
Created: 2026-04-30
Updated: 2026-04-30

## Goal

- Write a durable hosted assistant input architecture and migration guide that
  decouples Codex from inbox capture while preserving durable input and delivery
  safety.

## Success criteria

- `docs/hosted-assistant-input-migration-guide.md` captures the target model,
  component boundaries, cursor model, failure boundaries, migration phases, and
  required tests.
- The guide is stress-tested against current hosted mailbox, assistant-engine,
  handling-evidence, and inbox projection code paths.
- The diff stays docs/process-only.

## Scope

- In scope:
  - One new migration guide under `docs/`.
  - This execution plan and the coordination-ledger row for the docs task.
  - Static code review references used to validate the guide.
- Out of scope:
  - Runtime implementation.
  - Tests beyond text-only doc readback/diff checks.
  - Updating live architecture references until implementation begins.

## Constraints

- Technical constraints:
  - Do not expose personal identifiers or local machine paths in docs.
  - Do not make inbox capture the Codex input source in the target plan.
  - Do not allow provider delivery before accepted input and reply intent are
    durable.
- Product/process constraints:
  - Follow docs/process-only workflow.
  - Preserve unrelated dirty tree edits.
  - Do not list this point-in-time migration guide in the canonical docs index
    unless it is promoted to a live reference.

## Risks and mitigations

1. Risk: The plan overfits current code and preserves unnecessary coupling.
   Mitigation: Stress-test against current code seams and prefer greenfield
   source-agnostic assistant input primitives.
2. Risk: The plan bypasses durability while bypassing inbox.
   Mitigation: Make `AssistantInputStore` the durable boundary before Codex.

## Tasks

1. Create coordination-ledger row.
2. Write the migration guide.
3. Review the guide against current code seams.
4. Run docs-only verification.
5. Close the plan and create the scoped docs commit if safe.

## Decisions

- Use `AssistantInputStore` as the canonical Codex input boundary.
- Keep hosted mailbox as encrypted ingress only.
- Keep inbox as projection/search/UI/audit surface, not assistant admission.
- Do not update `agent-docs/index.md` because this is a point-in-time migration
  guide and the index explicitly excludes migration guides.

## Verification

- Commands to run:
  - Read back `docs/hosted-assistant-input-migration-guide.md`.
  - `git diff --check -- docs/hosted-assistant-input-migration-guide.md agent-docs/exec-plans/active/2026-04-30-hosted-assistant-input-architecture.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Expected outcomes:
  - Touched docs are internally consistent.
  - Diff has no whitespace errors.
Completed: 2026-04-30
