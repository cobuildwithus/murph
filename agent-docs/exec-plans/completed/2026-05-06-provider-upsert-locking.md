# Provider Upsert Locking

## Goal

Fix the provider markdown-registry upsert race where concurrent direct upserts can both observe a missing slug, generate different provider ids, and let the later commit overwrite the first record.

## Constraints

- Keep the fix narrow, simple, and aligned with existing canonical write-lock patterns.
- Preserve existing provider selector, rename, body, and audit behavior.
- Do not touch unrelated active worktree changes.

## Plan

1. Re-read the provider upsert path and the canonical write-lock helper.
2. Hold the canonical write lock across provider registry read, target resolution, and commit.
3. Add focused regression coverage for concurrent direct provider upserts.
4. Run scoped core verification, typecheck, required audits, and inspect the final diff.

## Verification

- `pnpm --dir packages/core test -- --runInBand health-bank.test.ts` passed; package script ran the full core test suite.
- `pnpm --dir packages/core test:coverage` passed.
- `pnpm --dir packages/core typecheck` passed.
- `pnpm test:smoke` passed.
- `git diff --check -- packages/core/src/bank/providers.ts packages/core/test/health-bank.test.ts agent-docs/exec-plans/active/2026-05-06-provider-upsert-locking.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- `pnpm typecheck` failed in unrelated hosted-local test typing under `scripts/dev-hosted-local/stack.test.ts`.
- `bash scripts/workspace-verify.sh test:diff packages/core/src/bank/providers.ts packages/core/test/health-bank.test.ts` failed later in unrelated assistant-runtime hosted mailbox tests after core and multiple reverse-dependent checks passed.
- `security-privacy-review` completed with no findings.
- `coverage-write` completed with no test edits needed.
- `task-finish-review` completed with no code findings; plan verification was updated from pending.

## State

- Complete; scoped commit blocked by overlapping unrelated dirty edits in `packages/core/test/health-bank.test.ts` and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
