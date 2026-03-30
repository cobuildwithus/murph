# Remove hosted usage compatibility leftovers

Status: completed
Created: 2026-03-30
Updated: 2026-03-30

## Goal

- Remove the last hosted usage compatibility branches so the hosted user-env payload only accepts the current schema and pending usage records require a stored `credentialSource` end-to-end instead of permitting/exporting inferred ownership.

## Success criteria

- `apps/cloudflare` hosted user-env decode rejects the removed legacy schema alias.
- assistant usage state/import/export contracts no longer permit null `credentialSource` values.
- `packages/assistant-runtime` exports pending usage rows exactly as stored, with no export-time ownership fallback path.
- Focused hosted-runtime and cloudflare tests pass after removing the obsolete compatibility regressions.
- Required audit passes and repo-required checks are run before handoff, with unrelated failures called out explicitly if they remain.

## Scope

- In scope:
- `apps/cloudflare/src/user-env.ts`
- `apps/cloudflare/test/user-env.test.ts`
- targeted `apps/cloudflare/test/node-runner.test.ts`
- targeted `apps/web/src/lib/hosted-execution/usage.ts`
- `packages/runtime-state/src/assistant-usage.ts`
- `packages/runtime-state/test/assistant-usage.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/usage.ts`
- `packages/assistant-runtime/src/hosted-runtime/execution.ts`
- `packages/assistant-runtime/test/hosted-runtime-usage.test.ts`
- coordination ledger / this plan
- Out of scope:
- unrelated hosted Stripe policy work
- older execution plans and unrelated assistant/runtime cleanup lanes

## Constraints

- Preserve overlapping dirty worktree edits outside this narrow hosted lane.
- Treat this as a hard cut: remove the compatibility branches rather than replacing them with new migration logic.

## Risks and mitigations

1. Risk: Removing export-time ownership inference could expose stale test fixtures or runtime assumptions that still permit null `credentialSource`.
   Mitigation: Tighten the shared assistant usage parser/type and update the remaining fixtures in the same change.
2. Risk: Removing the legacy hosted user-env schema alias could leave decode tests asserting the old format.
   Mitigation: Keep only current-schema round-trip coverage and let invalid-schema failures surface naturally.

## Tasks

1. Register the hosted compatibility hard-cut lane in the coordination ledger.
2. Remove the legacy hosted user-env schema alias and the hosted usage ownership fallback/nullability seams.
3. Trim obsolete tests and rerun focused verification.
4. Run required audit passes, repo-required checks, and finish through the repo commit flow.

## Decisions

- No legacy hosted payload schema aliases remain after this change.
- Pending usage storage/import/export now requires `credentialSource` to already be persisted on the row.

## Verification

- Commands to run:
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/user-env.test.ts --no-coverage --maxWorkers 1`
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/node-runner.test.ts -t "exports pending hosted AI usage through the worker proxy without exposing the internal web token" --no-coverage --maxWorkers 1`
- `pnpm exec vitest run --config vitest.config.ts packages/runtime-state/test/assistant-usage.test.ts --no-coverage --maxWorkers 1`
- `pnpm exec vitest run --config vitest.config.ts packages/assistant-runtime/test/hosted-runtime-usage.test.ts --no-coverage --maxWorkers 1`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
Completed: 2026-03-30
