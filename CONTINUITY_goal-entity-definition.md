Goal (incl. success criteria):
- Port Goal onto one shared registry entity definition used by contracts, core, query, and CLI while preserving the existing markdown plus JSONL storage model and Goal behavior.

Constraints/Assumptions:
- Goal is the only family in scope for this task.
- Shared abstractions should be introduced only where Goal already needs them.
- Overlapping active rows exist in CLI descriptor and query helper files; preserve adjacent edits.

Key decisions:
- UNCONFIRMED: whether the shared definition should live entirely in `packages/contracts/src/health-entities.ts` or be split between contracts and core-specific adapters.

State:
- Completed.

Done:
- Read repo routing docs, architecture/process docs, and the health entity taxonomy seam note.
- Claimed a narrow coordination-ledger lane and opened an execution plan for the Goal refactor.
- Landed the shared Goal registry definition in contracts with Goal frontmatter schema, Goal upsert payload schema, Goal relation metadata, and Goal command metadata.
- Refactored Goal core/query/CLI consumers onto the shared definition.
- Added focused Goal regression tests in core, query, and CLI, including partial-update and legacy-frontmatter compatibility coverage.
- Resolved the final-review regressions by adding a Goal patch payload schema for omission-safe CLI updates and a tolerant Goal read schema for legacy/defaultable frontmatter.
- Verified the Goal seam with:
  - `pnpm --dir packages/contracts build && node packages/contracts/dist/scripts/verify.js`
  - `pnpm --dir packages/core typecheck`
  - `pnpm --dir packages/query typecheck`
  - `pnpm exec vitest run packages/core/test/health-bank.test.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run packages/query/test/health-registry-definitions.test.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run packages/cli/test/health-tail.test.ts --no-coverage --maxWorkers 1`
  - a source-level explicit Goal CLI service scenario proving omission-safe patching and invalid relation-id rejection
- Ran the repo-required checks `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`; they remain blocked outside Goal scope by pre-existing failures in `packages/cli` assistant tests and `apps/web` hosted execution typing.

Now:
- Preparing final commit cleanup.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether the repo-maintainer wants the richer shared definition shape propagated immediately to Condition and Allergy after Goal.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/2026-03-29-goal-entity-definition.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `CONTINUITY_goal-entity-definition.md`
- `rg -n "goal|Goal" packages/contracts/src packages/core/src packages/query/src packages/cli/src`
- `pnpm --dir packages/contracts build && node packages/contracts/dist/scripts/verify.js`
- `pnpm --dir packages/core typecheck && pnpm --dir packages/core test`
- `pnpm --dir packages/query typecheck && pnpm --dir packages/query test`
- `pnpm exec tsx packages/cli/src/bin.ts goal upsert ...`
