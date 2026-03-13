Goal (incl. success criteria):
- Replace importer-local hand-rolled request/preset validation with Zod-backed parsing where it reduces duplication and preserves current behavior.
- Keep changes out of active owned lanes and preserve importer payload shapes/error expectations closely enough for existing callers/tests.

Constraints/Assumptions:
- Do not edit files owned by `codex-zod-cutover`, `codex-storage-spine-hardening`, or `codex-release-flow`.
- Keep scope within `packages/importers` files that are not currently claimed, plus package-local dependency metadata if needed.
- Preserve external importer APIs and avoid changing CLI-owned surfaces.

Key decisions:
- Focus on importer request/preset parsing instead of contracts/query because contracts are actively owned and importer normalization is the highest-value unowned cleanup.
- Use package-local Zod schemas/helpers rather than adding cross-package dependencies on contracts internals.

State:
- in_progress

Done:
- Reviewed repo instructions, verification docs, completion workflow, and active ownership ledger.
- Surveyed hand-rolled validation in contracts, importers, query, and tests.

Now:
- Claim importer cleanup scope in the coordination ledger.
- Implement Zod-backed parsing for importer inputs/presets and add targeted tests in unowned files.

Next:
- Run simplify, coverage audit, required verification, and commit scoped files.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: Whether any callers rely on exact thrown error text for importer parsing beyond current tests.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `packages/importers/package.json`
- `packages/importers/src/shared.ts`
- `packages/importers/src/preset-registry.ts`
- `packages/importers/src/document-importer.ts`
- `packages/importers/src/meal-importer.ts`
- `packages/importers/src/assessment/import-assessment-response.ts`
- `packages/importers/test/input-validation.test.ts`
- Commands: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
Status: completed
Updated: 2026-03-13
Completed: 2026-03-13
