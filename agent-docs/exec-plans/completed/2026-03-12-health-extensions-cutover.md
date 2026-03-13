# Health extensions cutover

Status: completed
Created: 2026-03-12
Updated: 2026-03-13

## Goal

- Extend the baseline vault from experiment/journal/sample primitives into a health-history model that keeps curated current state in Markdown, append-only history in JSONL, and a payload-first CLI that agents can drive with `scaffold`, `upsert --input`, `show`, and `list`.

## Success criteria

- Contract docs and `packages/contracts` freeze the new health resource names, id prefixes, schemas, examples, and JSON Schema artifacts.
- The vault layout supports assessment ledgers, profile snapshots, richer event history, and Markdown registries for profile, goals, conditions, allergies, regimens, family, and genetics.
- Core and importer APIs support:
  - assessment import into `raw/assessments` plus `ledger/assessments`
  - deterministic assessment projection into typed proposal objects
  - profile snapshot append plus `bank/profile/current.md` rebuild
  - Markdown registry upserts for goals, conditions, allergies, regimens, family members, and genetics
  - health-history event append for `encounter`, `procedure`, `test`, `adverse_effect`, and `exposure`
- Query and CLI layers expose the new nouns with a stable payload-first command surface and read model coverage.
- Fixtures and smoke scenarios cover the new changeover flow.
- Required checks and completion-workflow audit passes run after integration.

## Scope

- In scope:
- health-extension contract fence and docs updates
- new core modules under `assessment`, `profile`, `bank`, `history`, `family`, and `genetics`
- importer support for assessment intake
- query/read-model support for health nouns and export-pack expansion
- CLI additions for intake, profile, goal, condition, allergy, regimen, history, family, and genetics
- fixture/e2e updates for the health changeover
- Out of scope:
- changes to `.env*`, secrets, or external services
- replacing the existing TypeScript migration effort or reworking unrelated package build plumbing
- new deployment/runtime targets
- broad refactors to old baseline commands unless needed to keep the new surface coherent

## Constraints

- Technical constraints:
- Follow `AGENTS.md` hard rules and keep the coordination ledger current before code edits.
- Do not edit `packages/core/src/mutations.ts`; the user indicated another agent owns that recovery lane.
- Build on top of the ongoing TypeScript-support work without reverting or rewriting it.
- Keep the storage split intentional:
  - Markdown for curated current state and human-edited registries
  - JSONL for append-only assessments, profile snapshots, events, samples, and audit
- Only `packages/core` owns canonical writes.
- Keep worker file ownership disjoint where possible; when ambient broad rows already exist, limit edits to the explicit files reserved here and treat unrelated TS work as ambient churn.
- Product/process constraints:
- Keep the CLI payload-first rather than flag-heavy.
- `bank/profile/current.md` remains derived from profile snapshots rather than becoming the sole source of truth.
- `ledger/events` remains the only timed-history ledger.
- Do not create a generic assessment-apply mutation in this cut; assessment projection returns typed proposals and noun-specific upserts apply them.

## Risks and mitigations

1. Risk: Broad active TS-migration rows overlap the same package trees.
   Mitigation: Limit this batch to explicitly reserved health-extension files, avoid touching the externally owned `mutations.ts`, and integrate around ambient changes instead of competing for broad package rewrites.
2. Risk: Parallel workers collide on shared seam files such as package indexes or CLI service wiring.
   Mitigation: Reserve seam files to the parent lane and have child workers own only bounded subtrees or docs.
3. Risk: The health-extension plan balloons into a repo-wide redesign.
   Mitigation: Freeze the contract fence first, keep JSONL only where append-only history matters, and preserve the baseline package boundaries.

## Tasks

1. Freeze the active health-extension plan and reserve parent/worker ownership in `COORDINATION_LEDGER.md`.
2. Generate one prompt per health-extension worker lane with explicit file boundaries and verification expectations.
3. Launch parallel codex-1 workers via `../workspace-docs/bin/codex-workers --profile 1 --sandbox workspace-write --full-auto`.
4. Land the contract fence:
   - vault layout docs
   - record-schema docs
   - command-surface grammar additions
   - new health contracts and JSON Schema artifacts
5. Land assessment intake plus projection support.
6. Land profile snapshot plus current-profile rebuild support.
7. Land Markdown registries for goals, conditions, allergies, regimens, family members, and genetics plus health-history event support.
8. Land query, CLI, fixture, and smoke updates for the new nouns and flows.
9. Reconcile seams in the parent lane, run completion-workflow audit passes, then run required verification and commit only touched files.

## Decisions

- Keep the hybrid storage model:
  - Markdown for curated human state
  - JSONL for append-only machine history
- Use these new id prefixes:
  - `asmt`
  - `psnap`
  - `goal`
  - `cond`
  - `alg`
  - `reg`
  - `fam`
  - `var`
- Extend `hv/event@v1`-equivalent health history kinds inside the existing event family with:
  - `encounter`
  - `procedure`
  - `test`
  - `adverse_effect`
  - `exposure`
- Freeze the CLI around:
  - `scaffold`
  - `upsert --input`
  - `show`
  - `list`
  - special cases for `intake import`, `intake project`, `profile current rebuild`, and `regimen stop`
- Goal records support multiple simultaneous active goals, horizon, priority, parent/child, and experiment links.

## Verification

- Commands to run:
- worker-local narrow checks per lane
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- `pnpm test:smoke`
- completion workflow audit passes:
  - `agent-docs/prompts/simplify.md`
  - `agent-docs/prompts/test-coverage-audit.md`
  - `agent-docs/prompts/task-finish-review.md`
- Expected outcomes:
- New health contracts validate and generated schemas stay in sync.
- CLI smoke scenarios cover the new nouns and their documented command shapes.
Completed: 2026-03-13
