# Make late-stage research seams consume page-builder artifacts directly

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Remove the fragile late-stage dependency on `responses/30-page-builder.md` by treating page-builder as an artifact-first seam and pointing QA/final prompts at stable downloaded builder files.

## Success criteria

- Generated research prompts for `31` through `34` read from page-builder downloads rather than `responses/30-page-builder.md`.
- The research runner treats page-builder-like artifact seams as successful when required builder artifacts land, even if no inline response markdown exists.
- The current cold-plunge workspace is updated so `31` through `34` can run immediately from the downloaded builder package.
- Repo tests cover the new artifact-first builder path.

## Scope

- In scope:
  - `scripts/research-orchestrator/lib.mjs`
  - `scripts/research-materialize.mjs`
  - `scripts/research-init.test.ts`
  - current cold-plunge workspace prompts needed to use the new flow immediately
  - this active plan
- Out of scope:
  - landing the cold-plunge Health Commons files themselves
  - changing discovery, reducer, extraction, or section-synthesis semantics
  - changing the normal non-research `review:gpt` flow

## Constraints

- Keep the change scoped to the research workflow.
- Prefer stable downloaded artifact paths over synthetic summary markdown.
- Preserve unrelated dirty-tree edits and avoid touching overlapping active rows unnecessarily.

## Tasks

1. [x] Register this lane in the coordination ledger.
2. [x] Add page-builder artifact contracts and artifact-first helper behavior.
3. [x] Update late-stage prompt generation to read builder downloads directly.
4. [x] Refresh the current cold-plunge workspace prompts for `31` through `34`.
5. [x] Run scoped verification and commit the repo tooling diff.

## Verification

- `node --check scripts/research-materialize.mjs`
- `node --check scripts/research-orchestrator/lib.mjs`
- `pnpm test:repo-tools -- --runInBand scripts/research-init.test.ts`
- `pnpm typecheck` (still fails on the unrelated pre-existing `packages/assistant-engine/test/assistant-local-service-runtime.test.ts(187,10)` tuple-index error)
- `git diff --check -- scripts/research-orchestrator/lib.mjs scripts/research-materialize.mjs scripts/research-orchestrator/prompts/evidence-qa.md scripts/research-orchestrator/prompts/safety-qa.md scripts/research-orchestrator/prompts/schema-artifact-qa.md scripts/research-orchestrator/prompts/final-landing-reducer.md scripts/research-init.test.ts agent-docs/exec-plans/active/2026-04-23-research-page-builder-artifact-flow.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Completed: 2026-04-23
