# Browser-vault checkpoint cleanup

Status: completed
Created: 2026-05-09
Updated: 2026-05-09

## Goal

- Make browser-vault replicas a single latest-ref live projection path instead of a checkpoint sidecar.

## Success criteria

- Full/base checkpoint generation writes only workspace snapshot refs.
- Checkpoint requests no longer persist, clear, or validate browser-vault refs.
- Browser-vault latest-ref publication remains available through the separate derived-data route.
- Focused tests cover checkpoint omission and latest-ref publish behavior.

## Scope

- In scope:
- `apps/cloudflare/src/runtime-bridge-workspace.ts`
- `apps/cloudflare/test/runtime-bridge-workspace.test.ts`
- `apps/web/src/lib/hosted-workspace/store.ts`
- `apps/web/app/api/internal/hosted-workspace/checkpoint/route.ts`
- focused hosted workspace tests/docs that describe the checkpoint/browser-vault contract
- Out of scope:
- Dashboard replica refresh internals, browser session route behavior, runner idle lifecycle changes, and unrelated dirty worktree edits.

## Constraints

- Preserve deployed-consumer tolerance for old checkpoint payloads where practical.
- Keep separate browser-vault latest-ref publish semantics and source-hash guard behavior.
- Do not weaken auth, crypto, or workspace CAS boundaries.
- Preserve unrelated active worktree edits.

## Risks and mitigations

1. Risk: old Cloudflare producers may still send browser-vault refs during deploy lag.
   Mitigation: web checkpoint route accepts the payload shape but ignores the field; the separate live refresh path remains authoritative.
2. Risk: stale tests encode old snapshot-hash coupling.
   Mitigation: replace those expectations with no checkpoint mutation plus explicit latest-ref publish coverage.

## Tasks

1. Remove checkpoint-time browser-vault sidecar generation.
2. Make web checkpoint persistence snapshot-only for browser-vault refs.
3. Update focused Cloudflare/web tests and durable architecture docs.
4. Run scoped verification and close out with the truthful commit status.

## Decisions

- Checkpoint payload compatibility stays at the parser/route boundary, but `checkpointHostedWorkspace` ignores `browserVaultReplicaRef`.
- The `/api/internal/hosted-workspace/browser-vault-replica` route remains the only hosted web writer for `browserVaultReplicaRef`.
- Latest-ref browser-vault publishes reject older `generatedAt` refs so a delayed refresh cannot replace a newer dashboard replica.

## Verification

- Passed: `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-workspace-store.test.ts -t "older latest" --no-coverage`.
- Passed: `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-workspace-store.test.ts apps/web/test/hosted-runtime-internal-routes.test.ts --no-coverage`.
- Passed: `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/runtime-bridge-workspace.test.ts --no-coverage`.
- Passed: `pnpm typecheck`.
- Passed: `git diff --check -- <task files>`.
- Blocked/unrelated: `bash scripts/workspace-verify.sh test:diff <task files>` expanded to `packages/cli` tests and failed outside this task's hosted browser-vault working set:
  - `packages/cli/test/document-meal-intervention-coverage.test.ts:273`
  - `packages/cli/test/cli-expansion-document-meal.test.ts:568`
  - `packages/cli/test/incur-smoke.test.ts:795` missing prepared CLI runtime artifacts.

## Closeout

- Implementation and verification are complete.
- Safe scoped commit is blocked by extensive unrelated dirty work, including pre-existing edits in some files touched for this task.
Completed: 2026-05-09
