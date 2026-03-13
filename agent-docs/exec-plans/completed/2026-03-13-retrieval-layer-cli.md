# Retrieval layer CLI

Status: completed
Created: 2026-03-13
Updated: 2026-03-12

## Goal

- Land the first retrieval milestone from the user-provided plan: local lexical search plus time-ordered retrieval in `@healthybob/query`, exposed as `vault-cli search` and `vault-cli timeline`.

## Success criteria

- `packages/query` exports `searchVault()` and `buildTimeline()` with deterministic lexical/timeline behavior over the current vault read model.
- `vault-cli` exposes top-level `search` and `timeline` commands with stable JSON/Markdown surfaces and structured filters aligned to the read model.
- Query and CLI tests cover the new retrieval paths end to end through the built CLI.
- Verification config and docs include the new retrieval modules and commands truthfully.

## Scope

- In scope:
- query-layer retrieval primitives, exports, and focused tests
- new CLI command module plus registration
- focused CLI runtime/help tests in unowned test files
- command-surface docs and verification/coverage config updates
- Out of scope:
- SQLite FTS, vectors, OCR, or document-text sidecars
- changes to actively owned CLI service/contracts/runtime-test files
- changes to canonical write behavior in `core` or `importers`

## Constraints

- Respect active ownership in `COORDINATION_LEDGER.md`; do not touch `packages/cli/src/vault-cli-services.ts`, `packages/cli/src/vault-cli-contracts.ts`, or `packages/cli/test/runtime.test.ts`.
- Keep retrieval local and dependency-light: no daemon, database, or model runtime.
- Search excludes raw sample rows by default unless the caller opts in.
- Timeline should emphasize journals, events, and daily sample summaries rather than raw minute-level sample rows.
- Because this touches production code and tests, run completion-workflow audit passes before final verification.

## Risks and mitigations

1. Risk: The user patch assumes service/contract seams that are currently owned by another active lane.
   Mitigation: implement CLI retrieval commands in a new command module with local schemas and direct query-package reads, then register them without touching owned seam files.
2. Risk: New tests will not run or count toward coverage because the current Vitest include list is explicit.
   Mitigation: update `vitest.config.ts` and the package/root test scripts in the same change.
3. Risk: Search over JSON payloads can surface noisy matches or overwhelm results with samples.
   Mitigation: boost title/tags/body matches, filter first, cap results, and keep `includeSamples` opt-in.

## Tasks

1. Add query-layer lexical search and timeline builders with exports and focused tests.
2. Add `packages/cli/src/commands/search.ts` and register it in `createVaultCli()`.
3. Add focused CLI runtime/help tests for `search` and `timeline`.
4. Update command-surface docs, package READMEs, and verification/coverage config.
5. Run completion-workflow audits, required checks, then remove the active ledger row and commit the scoped files.

## Decisions

- Retrieval stage one stays entirely inside `@healthybob/query`.
- CLI retrieval commands will directly read from `@healthybob/query` rather than extending the currently owned service/contracts seam.
- `search` and `timeline` are top-level commands, parallel to existing `show`/`list` read commands.

## Outcome

- Done: query-layer lexical `searchVault()` and `buildTimeline()` landed with exports, targeted tests, and CLI command coverage.
- Done: `vault-cli search` and `vault-cli timeline` landed through a dedicated `packages/cli/src/query-runtime.ts` adapter so the command module stays declarative without touching the actively owned CLI service seam.
- Done: command-surface docs, verification docs, Vitest coverage targets, and smoke-scenario scaffolds now cover the retrieval commands truthfully.
- Verification: `pnpm exec vitest run packages/query/test/query.test.ts packages/cli/test/incur-smoke.test.ts packages/cli/test/search-runtime.test.ts --no-coverage --maxWorkers 1` passed.
- Verification: `pnpm test` passed.
- Verification: `pnpm test:coverage` passed.
- Verification: `pnpm typecheck` still fails in the active contracts lane because `packages/contracts/scripts/generate-json-schema.ts` and `packages/contracts/scripts/verify.ts` cannot resolve `@healthybob/contracts/schemas`; the retrieval-layer files do not participate in that import path.

## Verification

- Commands to run:
- `pnpm exec vitest run packages/query/test/query.test.ts packages/cli/test/incur-smoke.test.ts packages/cli/test/search-runtime.test.ts --no-coverage --maxWorkers 1`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- completion workflow audit passes:
  - `agent-docs/prompts/simplify.md`
  - `agent-docs/prompts/test-coverage-audit.md`
  - `agent-docs/prompts/task-finish-review.md`
Completed: 2026-03-12
