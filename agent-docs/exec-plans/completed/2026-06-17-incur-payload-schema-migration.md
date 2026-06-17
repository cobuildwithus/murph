# Incur payload schema migration guide

Status: completed
Created: 2026-06-17
Updated: 2026-06-17

## Goal

- Produce a repo-local migration guide that explains how Murph should expose deep writable payload schemas through the Incur CLI surface without fighting Incur's command-input model.

## Success criteria

- The guide cites current Murph CLI/Incur behavior with concrete source evidence.
- The guide defines the target command-surface pattern, phased migration steps, and acceptance checks.
- Durable docs index is updated if the guide is added as a canonical reference.

## Scope

- In scope: review of Incur command schema, MCP, skills/LLMS discovery, Murph health payload import/scaffold surfaces, and docs-only migration guidance.
- Out of scope: implementation of new commands or generated schemas in this task.

## Constraints

- Technical constraints: stay compatible with Incur's args/options/env/output discovery model; keep import-file workflows for humans and bulk inputs; avoid inventing a parallel CLI framework.
- Product/process constraints: preserve current command compatibility and favor simple, composable primitives.

## Risks and mitigations

1. Risk: The guide over-specifies implementation before code owners validate details.
   Mitigation: Keep phases concrete but route schema ownership to existing contract/core/usecase owners.
2. Risk: A docs-only migration guide drifts from runtime behavior.
   Mitigation: Anchor claims to source files and define tests/acceptance checks for the later implementation.

## Tasks

1. Inspect Incur's command schema, MCP, and skills/LLMS discovery source.
2. Inspect Murph's file-backed import, scaffold, and typed health command surfaces.
3. Write the migration guide and add a command-surface pointer.
4. Run docs-only verification and finish the plan.

## Decisions

- Add the migration guide under `docs/` as a current engineering guide rather than under `agent-docs/exec-plans/`, because it should outlive this task and guide future CLI implementation.
- Do not add the guide to `agent-docs/index.md`: that index explicitly excludes migration guides. Link it from `docs/contracts/03-command-surface.md` instead because the issue is a command-surface migration.

## Verification

- Commands to run: docs readback plus `pnpm typecheck` per docs/process verification policy.
- Expected outcomes: the guide is internally consistent, command-surface pointer exists, and typecheck passes or any unrelated failure is reported.

## Outcomes

- Added `docs/incur-payload-schema-migration-guide.md`.
- Updated `docs/contracts/03-command-surface.md` to clarify that scaffold is an example, not the exact file-body contract, and to point at the migration guide.
- Verified changed files contain no local personal identifiers or non-ASCII text introduced by this task.
- `pnpm typecheck` passed on 2026-06-17.
- `pnpm test:diff -- docs/incur-payload-schema-migration-guide.md docs/contracts/03-command-surface.md agent-docs/exec-plans/active/2026-06-17-incur-payload-schema-migration.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed on 2026-06-17.
Completed: 2026-06-17
