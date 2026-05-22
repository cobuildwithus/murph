# R2 Snapshot Timing Diagnostics

## Goal

Add safe production diagnostics that split hosted workspace v2 checkpoint time
into archive/encryption work and direct R2 upload work.

## Scope

- `apps/cloudflare/src/runtime-bridge-workspace.ts`
- `apps/cloudflare/test/runtime-bridge-workspace.test.ts`
- Focused hosted runtime log parser tests if the redacted metadata contract
  needs updates

## Constraints

- Metadata-only diagnostics. Do not log raw object keys, snapshot ids, hashes,
  paths, URLs, user/member ids, prompts, transcripts, provider payloads,
  secrets, or authorization values.
- Preserve the existing `snapshotElapsedMs` field as total checkpoint duration.
- Keep diagnostics useful on both success and failure when a step has already
  completed.
- Preserve unrelated dirty worktree edits.

## Plan

1. Record per-step millisecond timings around snapshot session start, legacy
   materialization/cleanup, archive planning, tar/zstd/encryption, direct R2
   upload, and completion callback.
2. Include those timings plus safe archive size/count metadata in
   `checkpoint.snapshot_finished`; include partial timings in
   `checkpoint.snapshot_failed`.
3. Add focused tests for successful snapshots and direct-upload failures.
4. Run focused verification, typecheck/acceptance as required, local privacy
   review, and a scoped commit if unrelated dirty work does not block it.

## Verification

- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runtime-bridge-workspace.test.ts`
  passed: 1 file, 32 tests.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runtime-bridge-workspace.ts apps/cloudflare/test/runtime-bridge-workspace.test.ts`
  passed, including `apps/cloudflare verify`: 79 files, 1095 tests.
- `git diff --check -- apps/cloudflare/src/runtime-bridge-workspace.ts apps/cloudflare/test/runtime-bridge-workspace.test.ts agent-docs/exec-plans/active/2026-05-22-r2-snapshot-timing-diagnostics.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  passed.

## State

- Implemented. `checkpoint.snapshot_finished` now includes per-step timing
  fields and safe archive byte/count metadata; `checkpoint.snapshot_failed`
  includes partial timings for completed steps.
Status: completed
Updated: 2026-05-22
Completed: 2026-05-22
