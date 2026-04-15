# Land next parallel review seam extractions

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Land the next four bounded composability follow-ups from the large-file review in parallel without disturbing unrelated active lanes or widening behavior.

## Success criteria

- `packages/device-syncd/src/store.ts` delegates one bounded table-family seam to a dedicated sibling module while keeping `SqliteDeviceSyncStore` as the owner boundary.
- `packages/assistant-engine/src/assistant/outbox.ts` delegates summary and inventory/quarantine helpers into sibling modules while keeping `outbox.ts` as the public facade.
- `packages/inboxd/src/kernel/sqlite.ts` delegates attachment-parse-job behavior into a dedicated sibling module while keeping the assembly root local.
- `packages/operator-config/src/operator-config.ts` delegates config storage/path/file-I/O helpers to a dedicated sibling module while keeping the public facade stable.
- Focused verification is green for touched owners, or any unrelated blocker is explicitly recorded.

## Scope

- In scope:
- `packages/device-syncd/src/{store.ts,store/oauth-states.ts}`
- `packages/assistant-engine/src/assistant/{outbox.ts,outbox/store.ts,outbox/summary.ts}`
- `packages/inboxd/src/kernel/{sqlite.ts,sqlite/parse-jobs.ts}`
- `packages/operator-config/src/{operator-config.ts,operator-config/storage.ts}`
- matching focused tests only where needed
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Out of scope:
- broader `cron.ts`, `web-fetch.ts`, or `capability-definitions.ts` work
- additional `inboxd` search extraction in the same pass
- `operator-config` assistant-defaults extraction in the same pass

## Constraints

- Preserve unrelated dirty-worktree edits.
- Keep existing public facades stable.
- Respect other active lanes already touching `assistant-engine` and `operator-config`; keep this pass seam-only.
- Prefer thin delegation over behavior rewrites.

## Risks and mitigations

1. Risk: parallel workers could overreach into neighboring ownership seams.
   Mitigation: assign disjoint write scopes and keep each ask to one bounded review-aligned extraction.
2. Risk: `assistant-engine` and `operator-config` have other active work in the tree.
   Mitigation: keep the touched files narrowly scoped to helper extraction and preserve current public entrypoints.
3. Risk: package-level checks may still hit unrelated workspace-state blockers.
   Mitigation: run focused owner checks first and record any unrelated failures explicitly.

## Tasks

1. Extract `device-syncd` OAuth-state helpers from `store.ts`.
2. Extract `assistant-engine/outbox` summary plus inventory/quarantine helpers.
3. Extract `inboxd` attachment parse-job helpers from `sqlite.ts`.
4. Extract `operator-config` storage/path/file-I/O helpers from `operator-config.ts`.
5. Run focused verification, the required final audit pass, and create a scoped commit.

## Outcomes

- Landed `packages/device-syncd/src/store/oauth-states.ts` and delegated the OAuth-state class methods from `store.ts`.
- Landed `packages/assistant-engine/src/assistant/outbox/{store.ts,summary.ts}` and reduced `outbox.ts` to a thinner facade over the extracted seams.
- Landed `packages/inboxd/src/kernel/sqlite/parse-jobs.ts` and delegated parse-job runtime-store behavior from `sqlite.ts` without widening into search extraction.
- Landed `packages/operator-config/src/operator-config/storage.ts` and delegated config path/file-I/O helpers from `operator-config.ts`.
- Added focused storage permission coverage in `packages/operator-config/test/operator-config-storage.test.ts` and refreshed the stale `zeroDataRetention` expectation in `packages/operator-config/test/operator-config-seam.test.ts`.

## Verification

- `pnpm --dir packages/device-syncd typecheck` ✅
- `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts --no-coverage test/store.test.ts` ✅
- `pnpm --dir packages/assistant-engine typecheck` ✅
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-outbox-runtime.test.ts test/assistant-outbox-thresholds.test.ts test/assistant-runtime-thresholds.test.ts` ✅
- `pnpm --dir packages/inboxd typecheck` ✅
- `pnpm --dir packages/inboxd exec vitest run test/inboxd.test.ts --no-coverage` ✅
- `pnpm --dir packages/operator-config typecheck` ✅
- `pnpm --dir packages/operator-config exec vitest run --config vitest.config.ts --no-coverage test/operator-config-seam.test.ts test/operator-config-storage.test.ts` ✅
- Required final audit pass: no findings
Completed: 2026-04-09
