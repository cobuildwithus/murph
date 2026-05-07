# Hosted Exact Write Persistence

## Goal

Implement the hosted persistence simplification plan:

- Canonical vault writes persist through one exact `vault-cli` / core `WriteBatch` contract.
- Live hosted runtime durability uses bounded runtime resume state, not broad workspace snapshots.
- Idle shutdown remains the only broad full/raw snapshot path and is cancellable.
- Direct hosted canonical file edits fail or remain non-durable; broad working checkpoint fallback must not rescue them.

## Scope

- `packages/core/src/operations/write-batch.ts` and direct tests for hosted canonical write receipts.
- Hosted runtime/core adapter seams needed to persist exact write receipts synchronously.
- Hosted workspace checkpoint code in `packages/assistant-runtime`, `packages/runtime-state`, and `apps/cloudflare`.
- Source-audit tests that prevent non-core canonical filesystem mutation paths.
- Durable hosted runtime protocol docs and verification map updates.

## Constraints

- Preserve unrelated worktree edits and active ledger rows.
- Do not add event sourcing, generic file watchers, or persistent Git durability.
- Do not keep a broad live working checkpoint fallback.
- Do not expose secrets, raw vault content, local usernames, or home paths in logs, docs, tests, or examples.
- Use deploy-compatible readers where old hosted snapshot refs may still exist.

## Risks

- Hosted write receipt persistence must fail closed if it cannot durably persist after a local write.
- Runtime resume allowlist must stay tight enough to avoid canonical/raw scans.
- Provider fences must stay tiny and idempotent.
- Idle compaction cancellation must abort before CAS/destroy when pending work appears.

## Verification

- Focused unit tests for core hosted canonical write receipts.
- Focused hosted runtime / Cloudflare tests proving live checkpoint reasons avoid `snapshotHostedExecutionContext`.
- Source audit test proving non-core hosted/assistant/cloudflare code does not mutate canonical vault paths directly.
- `pnpm typecheck`.
- `pnpm test:diff` for touched files, or the required owner/app verification commands if the diff-aware lane is not truthful.

## Progress

- Implemented exact hosted canonical write receipts in core `WriteBatch`, including raw/text/jsonl/delete receipt actions and fail-closed rollback when the hosted receipt sink fails.
- Wired hosted process env to persist canonical write receipts under assistant runtime receipts, which are included by the bounded hot-state snapshot path.
- Replaced new live Cloudflare checkpoint production with layered `{base, hot}` bundles and removed the live full/working fallback.
- Added idle full-snapshot lease checks during the broad snapshot walk.
- Updated focused tests and hosted runtime docs for the exact-write / hot-state / idle-compaction contract.
- Final verification passed on 2026-05-07: `pnpm verify:repo` and `pnpm --dir apps/cloudflare test:e2e:local`.
Status: completed
Updated: 2026-05-08
Completed: 2026-05-08
