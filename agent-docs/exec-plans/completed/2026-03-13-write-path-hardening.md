# 2026-03-13 Write Path Hardening

## Goal

Fix the reported write-path, raw-layout, and validation integrity issues across CLI, core, and query without regressing existing command behavior.

## Success Criteria

- CLI JSON payload commands cannot override reserved write-target fields or silently coerce malformed profile snapshots.
- Vault path checks reject traversal, drive-prefixed pseudo-relative paths, and symlink escapes for canonical writes.
- Assessment imports write canonical `raw/assessments/.../source.json` paths and validate cleanly end to end.
- Sample batch imports validate before mutating canonical ledgers and do not half-commit on bad rows.
- History event writes validate against the canonical event schema before append.
- Vault validation covers raw-manifest/reference existence and derived current-profile consistency.
- Export-pack materialization cannot escape the requested output directory.

## Constraints

- Work on top of an already dirty tree without reverting unrelated edits.
- Keep changes surgical in files that already carry active in-progress edits.
- Preserve external command names and public package entrypoints unless a safety fix requires stricter rejection of malformed input.

## Planned Files

- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-03-13-write-path-hardening.md`
- `packages/cli/src/vault-cli-services.ts`
- `packages/core/src/path-safety.ts`
- `packages/core/src/fs.ts`
- `packages/core/src/raw.ts`
- `packages/core/src/assessment/storage.ts`
- `packages/core/src/mutations.ts`
- `packages/core/src/history/api.ts`
- `packages/core/src/vault.ts`
- `packages/core/src/profile/storage.ts`
- `packages/query/src/export-pack.ts`
- tests covering the hardened paths in package-local test files as needed

## Notes

- Narrow symbol ownership inside already-edited files to the specific hardening helpers touched by this task.
- If a finding can be fixed without changing a currently owned symbol, prefer that route over broader refactors.
