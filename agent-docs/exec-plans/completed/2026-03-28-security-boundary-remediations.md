# 2026-03-28 Security Boundary Remediations

## Goal

- Remove the reported trust-boundary breaks across canonical write metadata, assistant guard replay, inbox routing input resolution, inbox promotions, and local device-sync callback redirects.

## Scope

- `packages/core/src/operations/write-batch.ts`
- `packages/core/test/core.test.ts`
- `packages/inboxd/test/idempotency-rebuild.test.ts`
- `packages/cli/src/assistant/canonical-write-guard.ts`
- `packages/cli/src/inbox-model-harness.ts`
- `packages/cli/src/inbox-app/promotions.ts`
- `packages/cli/src/inbox-services/promotions.ts`
- `packages/cli/test/{assistant-service.test.ts,inbox-model-harness.test.ts,inbox-cli.test.ts}`
- `packages/device-syncd/src/http.ts`
- `packages/device-syncd/test/{http.test.ts,http-redirects.test.ts}`
- `apps/web/src/lib/device-sync/http.ts`
- `apps/web/test/device-sync-http.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Findings

- Replaced committed payload blobs with digest/length receipts in durable metadata and short-lived trusted guard receipts outside the vault.
- Assistant guard now authorizes protected canonical writes from trusted temp receipts only, normalizes protected-path checks, rejects new invalid metadata files, and does not use `stageRelativePath` as an authorization channel.
- Inbox routing now re-anchors manifest and image reads to the capture-specific subtree, rejecting in-vault cross-subtree reads.
- Inbox promotions now resolve attachment files against the capture subtree derived from the capture envelope path and always recompute SHA-256 from the verified file.
- Local `device-syncd` callback redirects now omit human-readable error text and share machine-readable redirect construction.

## Constraints

- Preserve overlapping dirty edits in `packages/core/src/operations/write-batch.ts`, `packages/cli/src/assistant/canonical-write-guard.ts`, promotion modules, and `packages/device-syncd/src/http.ts`.
- Do not introduce new cross-package source-import violations; shared helpers must stay behind existing public entrypoints or local file boundaries.
- Keep the fixes conservative: reject or roll back on untrusted metadata instead of inventing permissive fallback behavior.

## Plan

1. Replace durable committed payload copies with non-reconstructive receipts and update recovery/guard consumers accordingly.
2. Tighten assistant guard operation replay so only trusted committed transitions affect expected canonical state, with normalized path checks and no stage-path authorization fallback.
3. Anchor inbox routing inputs to per-capture attachment subtrees and add regressions for cross-subtree vault reads.
4. Harden inbox promotions with verified attachment path resolution plus always-recomputed SHA-256.
5. Make local device-sync callback redirects use the same machine-readable-only contract as hosted code and align tests.
6. Run focused package tests, then required repo checks, then the mandatory `simplify` audit plus the final review audit that also checks coverage/proof gaps.

## Verification

- Focused regressions passed:
  - `pnpm exec vitest run packages/core/test/core.test.ts packages/inboxd/test/idempotency-rebuild.test.ts packages/cli/test/assistant-service.test.ts packages/cli/test/inbox-model-harness.test.ts packages/cli/test/inbox-model-route.test.ts packages/cli/test/inbox-cli.test.ts packages/cli/test/cli-expansion-workout.test.ts packages/device-syncd/test/http.test.ts packages/device-syncd/test/http-redirects.test.ts apps/web/test/device-sync-http.test.ts --no-coverage --maxWorkers 1`
- Repo-wide checks are still blocked by pre-existing workspace issues outside this patch set:
  - `pnpm typecheck` flaked in workspace build orchestration (`packages/runtime-state/dist` cleanup and `assistant-runtime`/`parsers` project-ref ordering).
  - `pnpm test` and `pnpm test:coverage` failed in pre-existing `packages/cli` type-resolution/typecheck paths around `@murph/contracts`, `@murph/query`, and unrelated query command typings.
