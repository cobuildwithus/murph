# Recipe First-Class Plan

## Goal

Add recipes as first-class vault records under `bank/recipes` with a dedicated `recipe` CLI noun, assistant recipe tools, and contract/core coverage that aligns with the current repo shape.

## Scope

- `packages/contracts`: recipe frontmatter contract, schema catalog/example coverage, generated JSON schema artifacts, command-surface capability wiring.
- `packages/core`: vault layout/validation updates plus a dedicated bank recipe writer exposed through public mutations and package exports.
- `packages/cli`: recipe scaffold/upsert/show/list use cases and command registration, assistant recipe tool wiring, manifest bindings, focused regression tests.
- Docs: README command table and frozen command-surface docs.

## Constraints

- Keep the change additive and provider-style; do not fold recipes into the generic health descriptor matrix.
- Preserve overlapping active CLI/contracts work and avoid unrelated refactors.
- Run required repo verification plus the completion-workflow audit passes before handoff.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- completion workflow: `simplify` -> `test-coverage-audit` -> `task-finish-review`

## Outcome

- Recipe records are wired through contracts/core/CLI with focused recipe coverage and generated schema output.
- Completion-workflow audit passes found no recipe-specific follow-up edits beyond the implemented focused tests.
- Required verification is partially green and partially blocked by unrelated pre-existing repo failures:
  - `pnpm typecheck`: fails in `packages/query` resolving `@murph/runtime-state`
  - `pnpm test`: root Vitest failure in `packages/cli/test/runtime.test.ts` (`importer-backed CLI commands return direct runtime payloads` timeout at 20s)
  - `pnpm test:coverage`: root covered Vitest failure in `packages/cli/test/runtime.test.ts` (`vault show, stats, and paths surface read-only vault metadata and counts` timeout at 15s)
