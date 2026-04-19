# Fail closed on canonical manifest path traversal in vault usecase reads

Status: completed
Created: 2026-04-19
Updated: 2026-04-19

## Goal

- Stop manifest reads in `packages/vault-usecases` from trusting canonical record attributes as already-safe vault-relative paths.
- Ensure any manifest path derived from attachments, raw refs, media paths, or document paths is validated through the shared vault path-safety seam before on-disk reads occur.

## Success criteria

- Document/meal and workout manifest reads resolve manifest files through the shared vault-safe helper instead of `path.join(vault, ...)`.
- Traversal or absolute-path inputs in canonical record attributes fail closed with CLI-safe errors rather than reading outside the vault root.
- Regression tests cover the invalid-path seam and the manifest-read behavior.

## Scope

- In scope:
- `packages/vault-usecases/src/usecases/document-meal-read.ts`
- `packages/vault-usecases/src/usecases/workout-read.ts`
- `packages/vault-usecases/src/usecases/vault-usecase-helpers.ts`
- Focused tests in `packages/vault-usecases/test/**` and CLI tests only if needed for stable coverage
- Out of scope:
- broader query-model cleanup
- canonical importer/write-path schema changes
- unrelated hosted or Cloudflare work already in flight

## Constraints

- Technical constraints:
- Reuse existing `resolveVaultPathOnDisk` / `resolveVaultRelativePath` architecture instead of adding ad hoc path validation.
- Keep valid manifest lookup behavior unchanged for normal vault-owned raw import directories.
- Product/process constraints:
- Preserve unrelated dirty worktree edits.
- Keep this as a narrow trust-boundary fix and avoid speculative abstraction.

## Risks and mitigations

1. Risk: tightening seam validation changes the CLI error surfaced for malformed canonical records.
   Mitigation: reuse the existing CLI-safe `invalid_path` mapping where possible and add focused tests for the intended failure mode.
2. Risk: duplicated validation logic across document/meal and workout reads would create another maintenance seam.
   Mitigation: centralize the manifest resolution helper in `vault-usecase-helpers`.

## Tasks

1. Add a shared helper that resolves and normalizes vault-relative manifest inputs safely for CLI-facing reads.
2. Route document/meal and workout manifest reads through that helper.
3. Add regression tests for valid manifest reads plus traversal/absolute-path rejection.
4. Run scoped verification and required review passes.

## Decisions

- Reuse the existing vault-usecase helper seam rather than pushing CLI-specific error shaping into `packages/core`.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:diff packages/vault-usecases/src/usecases/document-meal-read.ts packages/vault-usecases/src/usecases/workout-read.ts packages/vault-usecases/src/usecases/vault-usecase-helpers.ts packages/vault-usecases/test/helpers-public-seams.test.ts packages/vault-usecases/test/record-service-coverage.test.ts`
- `pnpm --dir packages/vault-usecases typecheck`
- `pnpm --dir packages/vault-usecases exec vitest run test/helpers-public-seams.test.ts test/record-service-coverage.test.ts`
- `pnpm --dir packages/vault-usecases test:coverage`
- Expected outcomes:
- `pnpm --dir packages/vault-usecases typecheck`: passed.
- `pnpm --dir packages/vault-usecases exec vitest run test/helpers-public-seams.test.ts test/record-service-coverage.test.ts`: passed.
- `pnpm --dir packages/vault-usecases test:coverage`: passed.
- `pnpm typecheck`: failed for unrelated pre-existing repo issues in `apps/web` workspace boundary checks and Prisma schema relations.
- `pnpm test:diff ...`: failed for unrelated pre-existing `packages/cli` tests plus the same `apps/web` workspace boundary issue; `packages/vault-usecases` typecheck/tests within that lane passed.
- Added regressions show valid manifest reads still work and invalid manifest-relative paths fail closed without reading outside the vault root.
Completed: 2026-04-19
