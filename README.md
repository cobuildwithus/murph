# Healthy Bob

Healthy Bob is a file-native health vault with Markdown as the human-reviewable source of truth, append-only JSONL ledgers for machine-readable records, and a thin CLI/operator surface layered on top of a shared core library.

## Current State

- Repository-local agent harness is installed.
- The baseline vault package layout and contract docs are scaffolded under `packages/` and `docs/contracts/`.
- `packages/contracts`, `packages/core`, `packages/importers`, and `packages/query` now agree on the frozen vault metadata, frontmatter, event, sample, and audit shapes.
- `packages/cli` now typechecks, builds, and executes against the local workspace toolchain and package boundaries.
- Deterministic fixtures, sample-import placeholders, golden-output scaffolding, and smoke scenario manifests now live under `fixtures/` and `e2e/`.
- Durable process and architecture docs live under `agent-docs/` plus `ARCHITECTURE.md` and `docs/architecture.md`.
- Runtime verification now covers contracts, the executable `core`/`importers`/`query` packages, and the built `vault-cli` package.

## Package Layout

- `packages/contracts`: shared schemas, types, and generated JSON Schema artifacts
- `packages/core`: canonical vault file operations and domain mutations
- `packages/cli`: `vault-cli` command surface
- `packages/importers`: ingestion adapters that call core write APIs
- `packages/query`: read model and export-pack generation

## Supporting Layout

- `docs/contracts/`: frozen interface docs used by all worker lanes
- `fixtures/`: minimal vault scaffold, sample-import placeholders, and golden-output directories
- `e2e/`: smoke manifests plus the executable fixture verifier
- `assistant-state/`: out-of-vault assistant/session state

## Verification

- `pnpm build`: compiles the workspace packages through the TypeScript project-reference graph
- `pnpm typecheck`: validates repo shell wrappers, typechecks repo-owned TS tools, typechecks every package, and verifies the solution-style `tsc -b` build
- `pnpm test`: runs agent-doc drift checks, package verification (`contracts`, `cli`, `core`, `importers`, `query`), and fixture/scenario integrity verification
- `pnpm test:coverage`: runs doc-gardening checks, package verification, smoke coverage verification, and the no-source-JS guard for `packages/` plus `e2e/`
- `pnpm test:packages`: runs the package-runtime checks without the worktree-sensitive doc-drift wrapper

These checks now execute a TypeScript-first package build path in-repo. Targeted manual runtime checks can execute `node packages/cli/dist/bin.js ...` against a local vault when a behavior seam needs end-to-end confirmation.

## Near-Term Scope

The first release includes only vault init/validate, document import, meal add, generic CSV sample import, experiment creation, journal ensure, show/list, and export-pack generation.
