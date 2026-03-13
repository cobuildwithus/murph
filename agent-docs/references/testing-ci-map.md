# Testing And CI Map

Last verified: 2026-03-13

## Current Repo Checks

| Command | Purpose | Current coverage |
| --- | --- | --- |
| `pnpm typecheck` | Shell syntax validation, repo-owned TS tools typecheck, package-local no-emit typecheck scripts, and the solution-style TypeScript build. | `scripts/*.sh`, `scripts/*.ts`, `e2e/smoke/verify-fixtures.ts`, `packages/contracts/**`, `packages/runtime-state/**`, `packages/cli/**`, `packages/core/**`, `packages/importers/**`, `packages/inboxd/**`, `packages/parsers/**`, `packages/query/**` |
| `pnpm test` | Agent-docs drift checks plus package verification and fixture/scenario integrity validation. | `AGENTS.md`, `ARCHITECTURE.md`, `agent-docs/**`, `packages/contracts/**`, `packages/runtime-state/**`, `packages/cli/**`, `packages/core/**`, `packages/importers/**`, `packages/inboxd/**`, `packages/parsers/**`, `packages/query/**`, `fixtures/**`, `e2e/smoke/scenarios/**` |
| `pnpm test:coverage` | Doc inventory/doc-gardening enforcement plus package verification, Vitest V8 per-file coverage gates on the directly exercised runtime modules, command-surface smoke coverage, and the source-artifact guard that rejects handwritten JS-like source files plus tracked `dist/`, `.test-dist/`, and `*.tsbuildinfo` residue under `packages/` and `e2e/`. | `agent-docs/**`, `ARCHITECTURE.md`, `README.md`, `docs/contracts/03-command-surface.md`, `packages/contracts/**`, `packages/runtime-state/**`, `packages/cli/**`, `packages/core/**`, `packages/importers/**`, `packages/inboxd/**`, `packages/parsers/**`, `packages/query/**`, `fixtures/**`, `e2e/smoke/**` |
| `pnpm test:packages` | Direct runtime verification for executable packages plus built CLI verification without the worktree-sensitive doc-drift wrapper. Runs the root Vitest suite after contracts verification, workspace build, and CLI package-shape validation. | `packages/contracts/**`, `packages/runtime-state/**`, `packages/cli/**`, `packages/core/**`, `packages/importers/**`, `packages/inboxd/**`, `packages/parsers/**`, `packages/query/**` |
| `pnpm test:packages:coverage` | Package-runtime verification with the same Vitest suite plus deterministic single-file execution and V8 coverage thresholds (`perFile`, `lines/functions/statements=85`, `branches=80`) on the targeted source coverage surface while inbox/parser tests still execute under coverage. | `packages/core/src/{constants,ids,jsonl,mutations,raw,vault}.ts`, `packages/importers/src/{csv-sample-importer,document-importer,meal-importer}.ts`, `packages/query/src/{export-pack,model,search,search-sqlite,summaries,timeline}.ts`, `packages/*/test/**/*.test.ts` |
| `pnpm test:smoke` | Standalone fixture/scenario integrity verification. | `fixtures/**`, `e2e/smoke/**`, `docs/contracts/03-command-surface.md` |

## Current Gaps

- Repo-level automation still does not run full end-to-end CLI scenario flows; it typechecks/builds the CLI package, now includes inbox service/runtime tests plus parser-worker/runtime tests, and the smoke verifier still covers fixture/scenario integrity separately.
- Fixture smoke still validates manifests and command-surface coverage, not end-to-end package orchestration.
- No CI workflow files exist yet.

## Update Rule

When real source code, CI, or deployment automation is added, update this file and `agent-docs/operations/verification-and-runtime.md` in the same change.
