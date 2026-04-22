# Scaffold review:gpt research orchestrator init workflow

Status: completed
Created: 2026-04-22
Updated: 2026-04-22

## Goal

- Add a root-level `research:init` scaffolder that creates a per-topic review:gpt research-orchestrator workspace without running the research itself.
- Land the new prompt architecture as tracked templates under a dedicated repo directory so the generated workspace is deterministic and reviewable.
- Make `pnpm research:init "cold plunge"` immediately useful by defaulting the topic to the `cold-water-immersion` family, generating cold-plunge-specific discovery shards, and emitting runnable initial review:gpt command wrappers for the charter and discovery tranche.

## Success criteria

- `pnpm research:init "cold plunge"` creates a new output package under `output-packages/research/` with:
  - protocol metadata and shard plan
  - generated prompt files
  - a runbook/readme
  - runnable command wrappers for the charter and discovery prompts
- The tracked template directory lives under `scripts/research-orchestrator/**` and covers the new DAG-style prompts.
- Focused tests prove the generated cold-plunge scaffold shape and root script wiring.

## Scope

- In scope:
- `package.json` root script wiring for `research:init`
- `scripts/research-init.mjs`
- `scripts/research-orchestrator/**` tracked templates, preset data, and helper docs
- Focused tooling tests under `scripts/**`
- Out of scope:
- Automatic multi-thread fan-out, reducer execution, or patch landing
- Replacing the existing `pnpm research` runner in this task
- Health Commons content generation or any live protocol/source landing work

## Constraints

- Technical constraints:
- Keep the change in repo-tooling surfaces; avoid widening into the Murph CLI command graph unless forced by local constraints.
- Preserve unrelated dirty-tree Health Commons and hosted-web edits already present in the checkout.
- The generated scaffold must be ASCII-only and must not embed local personal identifiers.
- Product/process constraints:
- Treat this as a low-risk repo-internal workflow/tooling change with focused verification unless the implementation expands beyond that lane.
- The generated workspace should be reviewable text artifacts, not opaque state.

## Risks and mitigations

1. Risk: The scaffold looks like a full orchestrator but later stages still require manual chaining.
   Mitigation: Make the generated runbook explicit about what is runnable now, what is template-only, and which artifacts feed later reducers.
2. Risk: Topic defaults for `cold plunge` choose the wrong family/slug shape.
   Mitigation: Add a cold-plunge preset with explicit `familySlug`, `protocolSlug`, shard list, and section seams.
3. Risk: The new command overlaps the legacy `pnpm research` mental model and confuses the user.
   Mitigation: Keep the command name `research:init`, leave `pnpm research` untouched, and generate a workspace readme that explains the distinction clearly.

## Tasks

1. Register this plan in the coordination ledger with a narrow file scope.
2. Add the tracked research-orchestrator template directory and cold-plunge preset data.
3. Implement `scripts/research-init.mjs` so it resolves topic metadata, creates the output package, and renders prompts plus runnable charter/discovery command wrappers.
4. Add focused tooling tests for script wiring and generated scaffold output.
5. Run the truthful verification lane for the touched tooling files and hand the user the exact `pnpm research:init "cold plunge"` command to run.

## Decisions

- Keep this as a root tooling command instead of adding a new Murph CLI subcommand.
- Do not replace `scripts/research.sh` in this task; ship `research:init` alongside it.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:repo-tools -- --runInBand scripts/research-init.test.ts`
- Expected outcomes:
  - Root tooling checks stay green for the touched script/package surfaces.
  - Focused repo-tools tests prove the scaffold output deterministically.
Completed: 2026-04-22
