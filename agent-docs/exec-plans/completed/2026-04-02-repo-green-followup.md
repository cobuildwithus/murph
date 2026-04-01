# Repo Green Follow-Up

## Goal

Get the current repo verification surface back to green for `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` while preserving the in-flight messaging-ingress and hosted-runtime work already present in the tree.

## Scope

- Fix the current hard verification failures observed during sequential reruns.
- Prefer shared config or focused test/verification fixes before editing active feature files.
- Keep the earlier CLI shim hardening in scope because it is part of the current dirty change set.

## Current failure snapshot

- `apps/cloudflare` typecheck/test lanes fail on `@murphai/messaging-ingress/{linq-webhook,telegram-webhook}` resolution from dependent packages.
- Parallel repo-wide verification introduced extra `next build` / dev-smoke lock contention; rerun sequentially before treating those as code bugs.
- `pnpm typecheck` final exit was still pending when this plan was created; treat the messaging-ingress subpath error as the leading blocker until reruns prove otherwise.

## Constraints

- Do not overwrite unrelated dirty-tree edits.
- Avoid package-boundary edits that conflict with the active exclusive messaging-ingress extraction unless a shared config fix is insufficient.
- Record any remaining unrelated red checks explicitly if they persist after the fix.

## Verification target

- `pnpm --dir packages/cli exec vitest run test/setup-cli.test.ts`
- `pnpm build:test-runtime:prepared`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
