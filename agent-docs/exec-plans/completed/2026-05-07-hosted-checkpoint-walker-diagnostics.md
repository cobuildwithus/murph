# Hosted Checkpoint Walker Diagnostics

## Goal

Add a fast debug-only artifact that explains exactly why hosted full checkpoints are walking or including many files.

## Scope

- `packages/runtime-state/src/hosted-bundle-node.ts`
- `packages/runtime-state/test/hosted-bundle.test.ts`
- Optional docs note for the debug env flag if needed.

## Constraints

- Preserve unrelated active hosted runner and hosted persistence edits.
- Gate detailed path output behind an explicit local/debug env flag.
- Keep committed code and test fixtures free of legal names, local account usernames, home directory paths, secrets, raw credentials, and full authorization headers.
- Use root-relative paths in debug artifacts rather than absolute host paths.

## Plan

1. Add an env-gated checkpoint walker trace in the hosted bundle snapshot walker.
2. Record each seen directory/file/symlink with root key, relative path, type, include/exclude decision, reason, size, and depth.
3. Write a JSON debug artifact to an explicit path or the OS temp directory when enabled.
4. Add focused tests for disabled-by-default behavior and enabled debug output.
5. Run focused package verification plus required audits.

## Verification

- PASS: `pnpm --filter @murphai/runtime-state exec vitest run --config vitest.config.ts --no-coverage test/hosted-bundle.test.ts` (56 tests)
- PASS: `pnpm --filter @murphai/runtime-state typecheck`
- PASS before audit follow-up: `bash scripts/workspace-verify.sh test:diff packages/runtime-state/src/hosted-bundle-node.ts packages/runtime-state/test/hosted-bundle.test.ts agent-docs/exec-plans/active/2026-05-07-hosted-checkpoint-walker-diagnostics.md`
- BLOCKED after audit follow-up: same `test:diff` lane passed package checks and `apps/cloudflare verify`, then failed in `apps/web verify` on an unrelated dirty `apps/web/src/lib/hosted-privacy/account-data-service.ts` provider-label type mismatch.
- BLOCKED after final hardening: same `test:diff` lane passed package typechecks/tests through `packages/runtime-state test` (158 tests) and was stopped while waiting on an unrelated existing `apps/web verify` workspace lock.
Status: completed
Updated: 2026-05-08
Completed: 2026-05-08
