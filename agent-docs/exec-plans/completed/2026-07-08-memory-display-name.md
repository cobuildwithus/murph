# Memory Display Name

## Goal

Remove the separate `bank/profile.md` display-name document and make canonical memory own the user's preferred display name through a typed save/read path that group sharing can use deterministically.

## Constraints

- Keep one deterministic resolver for group display names; do not let group projections scrape arbitrary freeform memory.
- Preserve consent semantics for group membership and `profile-name.v0` delivery.
- Keep the CLI surface simple and truthful through Incur-generated command metadata.
- Delete obsolete profile document code/docs instead of leaving compatibility shims unless a real shipped compatibility window requires one.
- Avoid writing direct personal identifiers in docs, tests, fixtures, or examples.

## Plan

1. Inspect the current profile, memory, CLI, projection, and group-share tests.
2. Add typed memory display-name save/read primitives and a `memory set-name` CLI command.
3. Replace profile projection reads with the memory resolver, including conservative legacy backfill from Identity memory.
4. Delete the profile command/document surface and update prompt/docs/contracts.
5. Refresh generated CLI metadata and update focused tests.
6. Run required verification, commit with `scripts/finish-task`, push, open a PR, and complete the ReviewGPT loop.

## Verification

- `pnpm --dir packages/contracts typecheck`
- `pnpm --dir packages/core typecheck`
- `pnpm --dir packages/query typecheck`
- `pnpm --dir packages/cli typecheck`
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir packages/contracts test:artifacts`
- `pnpm --dir packages/contracts test:vitest`
- `pnpm --dir packages/core test`
- `pnpm --dir packages/query test`
- `pnpm --dir packages/assistant-engine test`
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/memory.test.ts packages/cli/test/incur-smoke.test.ts packages/cli/test/vault-cli-command-routing.test.ts packages/cli/test/vault-cli-routing.test.ts packages/cli/test/vault-cli-startup-imports.test.ts --no-coverage`
- `pnpm exec vitest run test/vault-share-projection.test.ts --config vitest.config.ts --no-coverage` from `packages/assistant-runtime`
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-group-store.test.ts --no-coverage`
- `pnpm exec tsx e2e/smoke/verify-scenario-integrity.ts`
- `git diff --check`
- `pnpm verify:workspace-boundaries`
- `pnpm verify:workspace-package-cycles`
- ReviewGPT PR loop to zero accepted findings

## State

Implemented in isolated worktree on branch `agent/memory-display-name`. Canonical memory now owns preferred display name through `memory set-name`; the `profile` document and command surface are deleted; `profile-name.v0` still delivers the same external projection payload from memory. Local verification is green; PR and ReviewGPT loop remain.
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
