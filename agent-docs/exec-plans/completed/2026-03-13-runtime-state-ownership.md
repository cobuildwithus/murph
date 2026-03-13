# 2026-03-13 Runtime State Ownership

## Goal

Make runtime-state ownership explicit by splitting query search state out of the inbox SQLite database, introducing a shared runtime-state resolver, and preserving one-release compatibility for existing search indexes.

## Success Criteria

- A shared runtime-state package exposes canonical `.runtime` paths for search and inbox state.
- Query search writes to `<vault>/.runtime/search.sqlite` instead of `<vault>/.runtime/inboxd.sqlite`.
- Query search status and reads preserve compatibility with legacy search tables stored in `<vault>/.runtime/inboxd.sqlite`.
- CLI/runtime docs and tests describe the split ownership model accurately.
- No files or symbols owned by other active ledger rows are touched.

## Constraints

- Work on top of the current dirty tree without reverting unrelated edits.
- Do not edit `packages/inboxd/src/kernel/sqlite.ts` or `packages/cli/src/inbox-services.ts` because another active ledger row currently owns those files.
- Keep compatibility logic explicit and limited to the query search runtime path migration.
- Update architecture/runtime docs in the same change because this alters the `.runtime` ownership boundary.

## Planned Files

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-03-13-runtime-state-ownership.md`
- `ARCHITECTURE.md`
- `agent-docs/index.md`
- `agent-docs/references/testing-ci-map.md`
- `agent-docs/operations/verification-and-runtime.md`
- `docs/architecture.md`
- `docs/contracts/03-command-surface.md`
- `package.json`
- `pnpm-lock.yaml`
- `tsconfig.base.json`
- `tsconfig.json`
- `vitest.config.ts`
- `packages/runtime-state/package.json`
- `packages/runtime-state/tsconfig.json`
- `packages/runtime-state/src/index.ts`
- `packages/query/package.json`
- `packages/query/tsconfig.json`
- `packages/query/tsconfig.test.json`
- `packages/query/src/search-sqlite.ts`
- `packages/query/test/query.test.ts`
- `packages/query/README.md`
- `packages/cli/test/search-runtime.test.ts`
- `packages/cli/README.md`
- `packages/inboxd/README.md`

## Notes

- The inbox runtime package will continue to own `<vault>/.runtime/inboxd.sqlite`; this change only removes query search ownership from that file.
- Shared SQLite open settings can be centralized for the new query runtime path immediately; inbox runtime adoption remains a follow-up while the owned file is busy.
Status: completed
Updated: 2026-03-13
Completed: 2026-03-13
