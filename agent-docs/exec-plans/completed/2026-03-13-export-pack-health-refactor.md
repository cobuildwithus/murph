Goal (incl. success criteria):
- Remove export-pack-specific reimplementation of health readers by sharing parse and transform logic with the query health modules.
- Preserve current export-pack contents and tolerance semantics for malformed health artifacts while keeping parse failures inspectable in structured form.

Constraints/Assumptions:
- Do not edit files owned by other active lanes, especially `packages/query/src/index.ts` and any CLI-owned files.
- Keep `buildExportPack` synchronous and preserve public export-pack payload shapes unless a testable compatibility issue forces a change.
- Tolerant parsing is allowed at the export-pack boundary, but low-level helpers should retain failure reason and path data for debugging.

Key decisions:
- Share pure record-transform helpers and tolerant file-read outcomes underneath both the async health query APIs and the synchronous export-pack builder.
- Keep parse-failure details internal for now; export-pack assembly may discard them after filtering invalid artifacts so current pack payloads stay stable.

State:
- in_progress

Done:
- Reviewed repo routing, reliability/security/testing docs, completion workflow, and active ownership constraints.
- Confirmed `export-pack-health.ts` duplicates profile snapshot, history, and registry readers and swallows parse failures without context.

Now:
- Refactor shared health loaders/parsers and update export-pack health assembly to use them.
- Extend tests around malformed JSON/frontmatter tolerance and current-profile fallback behavior.

Next:
- Run simplify, coverage audit, required verification, and commit touched files.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: Whether any future caller should expose parse-failure details publicly instead of keeping them internal to tolerant export-pack assembly.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-03-13-export-pack-health-refactor.md`
- `packages/query/src/export-pack.ts`
- `packages/query/src/export-pack-health.ts`
- `packages/query/src/health/shared.ts`
- `packages/query/src/health/assessments.ts`
- `packages/query/src/health/profile-snapshots.ts`
- `packages/query/src/health/history.ts`
- `packages/query/src/health/registries.ts`
- `packages/query/src/health/loaders.ts`
- `packages/query/test/health-tail.test.ts`
- Commands: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
Status: completed
Updated: 2026-03-13
Completed: 2026-03-13
