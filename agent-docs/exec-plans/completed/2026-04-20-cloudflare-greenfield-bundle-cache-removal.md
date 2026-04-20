# Remove durable DO bundle-ref cache for greenfield hosted runs

Status: completed
Created: 2026-04-20
Updated: 2026-04-20

## Goal

- Remove the remaining Durable Object SQLite `bundle_ref_json` / `bundle_version` cache so Cloudflare restores and commits bundles only from web-owned hosted-run snapshot refs.

## Success criteria

- `runner_meta` no longer requires or persists bundle-ref/version columns.
- Cloudflare bundle restore reads from `HostedRun.inputSnapshotRef` or the acquired cursor snapshot ref instead of DO-local durable cache.
- Cloudflare bundle writes no longer depend on a DO-local bundle version fence.
- Docs and tests stop describing the DO-local bundle ref as authoritative or durable correctness state.

## Scope

- `apps/cloudflare/src/user-runner/{runner-state-schema,runner-state-store,runner-state-helpers,runner-bundle-sync,types}.ts`
- `apps/cloudflare/src/user-runner.ts`
- focused `apps/cloudflare/test/**` coverage for runner state, bundle sync, and worker test helpers
- current-state docs that still claim Durable Object SQLite stores bundle refs durably

## Constraints

- Greenfield rule: prefer full removal over renaming/demotion.
- Preserve unrelated dirty-tree edits across `apps/cloudflare`, `apps/web`, and shared hosted packages.
- Do not move canonical snapshot ownership out of `apps/web`; use acquired run `inputSnapshotRef` / cursor snapshot refs as the source of truth.
- Keep any warm cache in memory only, and do not make it correctness-bearing.

## Verification

- passed: `git diff --check`
- passed: `pnpm exec vitest run apps/cloudflare/test/runner-state-store.bundle-slots.test.ts apps/cloudflare/test/runner-bundle-helpers.test.ts --config apps/cloudflare/vitest.config.ts`
- failed for unrelated pre-existing test drift: `pnpm --dir apps/cloudflare typecheck`
  - blocker: `apps/cloudflare/test/workers/test-hosted-wake-control.ts` still imports removed `HostedWake*` contracts and treats `runtime.timer` as a `HostedIngressEnvelope`
- failed for the same unrelated blocker: `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner/runner-bundle-sync.ts apps/cloudflare/src/user-runner/runner-state-helpers.ts apps/cloudflare/src/user-runner/runner-state-schema.ts apps/cloudflare/src/user-runner/runner-state-store.ts apps/cloudflare/src/user-runner/types.ts apps/cloudflare/test/runner-bundle-helpers.test.ts apps/cloudflare/test/runner-state-store.bundle-slots.test.ts apps/cloudflare/test/sql-storage.ts apps/cloudflare/README.md ARCHITECTURE.md agent-docs/operations/verification-and-runtime.md`

## Notes

- `runner_meta` now excludes bundle-ref/version persistence entirely; only the DO in-memory warm cache remains, and status reflects that cache instead of durable SQLite state.
- `RunnerBundleSync` now accepts explicit snapshot refs for the greenfield run path and keeps a compatibility fallback to the in-memory cache so the older tracked wake-path files still compile without reintroducing durable bundle truth.
- I intentionally did not commit the overlapping `user-runner.ts` / `runner-run-processor.ts` naming-hard-cut files in this lane.
Completed: 2026-04-20
