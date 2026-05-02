Goal (incl. success criteria):
Remove legacy memory compatibility from the contracts package. Success means memory frontmatter parsing accepts only the current schema, memory record ids accept only `mem_<ULID>`, parsed records require hidden metadata comments, no hash-derived fallback ids remain, and contract docs no longer promise legacy memory read compatibility.

Constraints/Assumptions:
- Preserve unrelated working-tree edits.
- No user data exists, so fail-closed hard cut is acceptable.
- `bank/memory.md` remains the canonical durable user-facing memory document.

Key decisions:
- Treat this as a high-risk schema/storage compatibility removal because it changes persisted memory reads.
- Keep the current schema version string unchanged because the target explicitly keeps `murph.frontmatter.memory.v1` as the current accepted frontmatter contract.

State:
Completed; archived without commit because overlapping unrelated dirty work made a safe scoped whole-file commit unsafe.

Done:
- Read required repo routing, architecture, product, verification, completion, and security docs.
- Confirmed the only pre-existing uncommitted git change is outside this slice.
- Removed legacy memory frontmatter/id compatibility and hash-derived fallback ids from `packages/contracts/src/memory.ts`.
- Required canonical hidden memory metadata with `mem_<ULID>`, `createdAt`, and `updatedAt`.
- Updated contracts and core tests for fail-closed legacy behavior.
- Updated contract docs to stop promising legacy memory read compatibility.
- Required security/privacy, coverage-write, and final review audits completed.

Now:
None.

Next:
None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/contracts/src/memory.ts`
- `packages/contracts/test/memory-shares-coverage.test.ts`
- `docs/contracts/02-record-schemas.md`
- `docs/contracts/03-command-surface.md`
- `packages/core/test/memory.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Passed: `pnpm --dir packages/contracts exec vitest run test/memory-shares-coverage.test.ts --config vitest.config.ts`
- Passed: `pnpm --dir packages/core exec vitest run test/memory.test.ts --config vitest.config.ts`
- Passed: `pnpm --dir packages/contracts test:coverage`
- Passed: `pnpm --dir packages/core test:coverage`
- Passed: `pnpm --dir packages/contracts typecheck`
- Passed: `pnpm --dir packages/core typecheck`
- Passed: `pnpm test:smoke`
- Blocked unrelated: latest `pnpm typecheck` fails in `apps/web/test/hosted-account-data-service.test.ts` on stale `field` property for `HostedMailboxPayloadCryptoMetadata`.
Status: completed
Updated: 2026-05-02
Completed: 2026-05-02
