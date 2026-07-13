# Simplify PR 568 snapshot restore hardening

Status: completed
Created: 2026-07-12

## Goal

- Reduce PR 568 to the smallest restore boundary that preserves an existing workspace until an authenticated staged restore succeeds.
- Remove duplicate restore-time archive policy, parser, benchmark, and speculative adversarial proof.

## Retained invariants

- V2 restore does not clear the current durable root before the staged restore succeeds.
- The exact encrypted object and plaintext archive remain authenticated and digest-checked before extraction.
- Extraction occurs in a sibling staging directory before durable-root replacement.
- Persisted process diagnostics contain structured status only, never stderr text.

## Work

1. Remove the restore-only tar inventory, capture-policy revalidation, parser bounds, portability export, benchmark, fixtures, tests, and matching security claims.
2. Preserve the focused failed-v2-restore regression and the existing capture-time archive-plan verification.
3. Verify focused snapshot and workspace-restore behavior, Cloudflare and assistant-runtime typechecks, diff coverage, privacy, and final scope.
4. Commit and push the simplification to PR 568, then wait for exact-head CI and the required changed-head final review gate.

## Constraints

- Preserve unrelated work and the existing PR branch history.
- Do not launch helpers, browsers, or ReviewGPT until the changed exact head is pushed and its review gate is coordinated.
- Do not weaken user/object binding, AES-GCM authentication, digest checks, size ceilings, staged extraction, or failure preservation.

## Verification evidence

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/workspace-snapshot-local.test.ts apps/cloudflare/test/runner-platform.test.ts`: 2 files, 129 tests passed.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-restore-codex-continuity.test.ts`: 1 file, 22 tests passed.
- `pnpm --dir packages/assistant-runtime typecheck`: passed.
- `pnpm --dir apps/cloudflare typecheck`: passed.
- `pnpm test:diff apps/cloudflare/src/workspace-snapshot-local.ts apps/cloudflare/src/runtime-platform/diagnostics.ts packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts`: passed; assistant-runtime 71 files / 1,529 passed / 2 skipped, Cloudflare 96 files / 1,735 passed.
- `git diff --check`: passed.
- Added-line and plan identifier/secret scan: clean.

## Completion review

- Security/privacy: existing owner/object binding, AES-GCM authentication, digest checks, size ceilings, and staged extraction are unchanged; removing persisted stderr bodies reduces exposure.
- Coverage: the retained regression exercises the actual assistant-runtime-to-snapshot-port failure boundary and proves both vault and operator-home contents survive.
- Simplification: deleted the duplicate restore inventory/policy path, benchmark command, shared benchmark fixture, test-only production surface, and matching configuration/docs/tests. No replacement abstraction or dependency was added.
- Parent final review: the effective PR code delta is limited to deferring durable-root replacement to the existing staged restore owner and omitting stderr text from structured diagnostics.
Updated: 2026-07-12
Completed: 2026-07-12
