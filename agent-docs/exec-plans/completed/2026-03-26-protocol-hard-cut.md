# Protocol Hard-Cut Plan

## Goal

Replace the `regimen` noun with `protocol` across the repo's command surfaces, contracts, prompts, docs, UI copy, and supporting code so the product exposes one consistent term.

## Scope

- `packages/cli`: command registration, manifests, assistant tools/prompts, use cases, generated CLI typings, and user-visible result/help text.
- `packages/contracts`: command capability language, examples, schemas, generated schema artifacts, and any public contract wording that exposes the noun.
- `packages/core` and `packages/query`: rename or adapt supporting registry/read-write APIs where the old noun leaks into public or shared repo surfaces.
- Docs/UI/prompts: frozen command-surface docs, architecture docs, agent docs/prompts, README, and operator-facing web copy.
- Tests/fixtures/generated artifacts required to keep the hard cut truthful.

## Constraints

- This is a hard cut, not an additive alias: prefer replacing `regimen` surfaces rather than supporting both names.
- Preserve the semantic distinction between `protocol`, `intervention`, and `experiment`.
- Preserve unrelated in-flight work in the dirty tree.
- Run required repo verification plus completion-workflow audit passes before handoff.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- completion workflow: `simplify` -> `test-coverage-audit` -> `task-finish-review`

## Outcome

- Renamed the first-class health noun, contracts, registry/storage paths, prompt copy, generated schema artifacts, fixtures, smoke scenarios, and assistant/tool surfaces from `regimen` to `protocol`.
- Preserved the existing semantic split:
  - `protocol` remains the durable plan/therapy/habit record.
  - `intervention` remains the quick-capture `intervention_session` event flow.
  - `experiment` remains the lifecycle record for structured tests.
- Updated intervention links and condition relations from `regimenId` / `relatedRegimenIds` to `protocolId` / `relatedProtocolIds`.
- Switched the canonical protocol id prefix from `reg_*` to `prot_*` and aligned generated schema/catalog output.
- Direct scenario evidence:
  - `node packages/cli/dist/bin.js protocol scaffold --vault fixtures/minimal-vault --format json`
  - local web inspection at desktop and mobile sizes via headless Chrome against `packages/web` with `VAULT=/Users/willhay/startup1/healthybob/fixtures/demo-web-vault`
- Verification:
  - `pnpm typecheck` passed
  - `pnpm test` passed
  - `pnpm test:coverage` passed
