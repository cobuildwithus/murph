# SQLite search runtime integration

Status: completed
Created: 2026-03-13
Updated: 2026-03-13

## Goal

- Land the downloaded SQLite search/runtime patch on top of the current retrieval layer so `vault-cli search` can use `auto|scan|sqlite`, the runtime index can be rebuilt and inspected, and the shared search logic stays aligned across scan and SQLite backends.

## Success criteria

- `packages/query` exposes shared search-materialization logic plus SQLite index rebuild/status/search helpers.
- CLI search supports backend selection plus `search index-status` and `search index-rebuild`.
- Docs and tests reflect the SQLite runtime index stored in `.runtime/inboxd.sqlite`.
- Required audits and verification run, with failures documented only if they are credibly pre-existing or tooling-blocked.

## Scope

- In scope:
- query-layer shared search helpers, SQLite runtime helpers, exports, and focused tests
- CLI query-runtime/search command wiring and focused tests
- retrieval docs/readmes/command-surface updates
- Out of scope:
- incremental indexing
- timeline migration to SQLite
- OCR or transcript sidecar ingestion

## Constraints

- Work on top of the current dirty tree; do not revert unrelated edits.
- Keep sample rows out of the SQLite FTS index and scan them only when the caller explicitly searches samples.
- Treat the SQLite index as derived runtime state under `.runtime/inboxd.sqlite`.
- Respect existing ownership lanes as much as possible; keep any overlap confined to retrieval/search symbols only.

## Risks and mitigations

1. Risk: The downloaded patch no longer applies cleanly because the tree has advanced.
   Mitigation: merge the intended behavior manually, using the patch only as a reference.
2. Risk: CLI/doc files already changed in adjacent work.
   Mitigation: restrict edits to search-specific command/runtime/docs sections and preserve surrounding changes.
3. Risk: Local verification may be limited by toolchain drift in the dirty workspace.
   Mitigation: run the required commands anyway, capture exact failures, and separate them from the scoped diff if needed.

## Tasks

1. Merge the query-layer shared search and SQLite runtime files.
2. Wire CLI search backend selection and index subcommands.
3. Update retrieval docs/readmes.
4. Run completion-workflow audits and required verification.
5. Remove the active ledger row and commit scoped files.

## Outcome

- Done: shared search document materialization, filtering, scoring, and snippet generation now live in one query-layer module used by both the scan path and the SQLite path.
- Done: SQLite retrieval helpers now rebuild and inspect a derived index in `.runtime/inboxd.sqlite`, keeping sample rows out of the SQLite search tables and merging them from a targeted vault scan only when sample search is explicitly requested.
- Done: `vault-cli search` now supports `--backend auto|scan|sqlite`, and `vault-cli search index-status` / `vault-cli search index-rebuild` work through the CLI surface via the entrypoint rewrite needed to preserve the intended command grammar on top of Incur.
- Done: query/CLI tests cover status non-creation, backend fallback, SQLite sample merge behavior, and the schema/runtime surfaces for the new search commands.
- Verification:
- `pnpm --dir packages/query typecheck` passed.
- `pnpm --dir packages/cli typecheck` passed.
- `pnpm exec vitest run packages/query/test/query.test.ts --no-coverage --maxWorkers 1` passed.
- `pnpm --dir packages/query build && pnpm --dir packages/cli build && pnpm exec vitest run packages/cli/test/search-runtime.test.ts packages/cli/test/incur-smoke.test.ts --no-coverage --maxWorkers 1` passed.
- `pnpm typecheck` passed.
- `pnpm test` failed for a pre-existing unrelated regression in `packages/cli/test/list-cursor-compat.test.ts` asserting that `goal list` help must not expose `--cursor`.
- `pnpm test:coverage` failed for the same pre-existing unrelated `packages/cli/test/list-cursor-compat.test.ts` assertion.
Completed: 2026-03-13
