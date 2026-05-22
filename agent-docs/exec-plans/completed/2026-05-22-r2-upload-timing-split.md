# R2 Upload Timing Split

## Goal

Split hosted workspace snapshot direct-upload timing so production can tell
whether slow checkpoint snapshots are spending time on the Cloudflare presign
request or on the container-to-R2 PUT.

## Scope

- `apps/cloudflare/src/runtime-bridge-workspace.ts`
- `apps/cloudflare/src/runtime-platform.ts`
- `apps/cloudflare/test/runtime-bridge-workspace.test.ts`
- `apps/cloudflare/test/runner-platform.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/platform.ts`

## Constraints

- Metadata-only diagnostics: elapsed milliseconds only.
- Do not log object keys, snapshot identifiers, presigned URLs, hashes, local
  paths, user/member identifiers, prompts, mailbox payloads, provider payloads,
  secrets, or authorization values.
- Preserve the existing total `snapshotDirectR2UploadElapsedMs` field for
  continuity with current production dashboards and queries.
- Preserve unrelated dirty worktree and ledger edits.

## Plan

1. Add a narrow return type for direct snapshot-upload sub-timings.
2. Measure presign and PUT elapsed time inside the real Cloudflare runtime port.
3. Merge returned sub-timings into existing checkpoint snapshot lifecycle logs.
4. Extend focused Cloudflare tests to prove fields are emitted without changing
   sensitive logging boundaries.
5. Run focused tests, Cloudflare typecheck, and required scoped verification.

## Verification

- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/runtime-bridge-workspace.test.ts test/runner-platform.test.ts --no-coverage`
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm --dir packages/assistant-runtime typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runtime-bridge-workspace.ts apps/cloudflare/src/runtime-platform.ts apps/cloudflare/test/runtime-bridge-workspace.test.ts apps/cloudflare/test/runner-platform.test.ts packages/assistant-runtime/src/hosted-runtime/platform.ts packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime-contracts.ts`
- `git diff --check -- apps/cloudflare/src/runtime-bridge-workspace.ts apps/cloudflare/src/runtime-platform.ts apps/cloudflare/test/runtime-bridge-workspace.test.ts apps/cloudflare/test/runner-platform.test.ts packages/assistant-runtime/src/hosted-runtime/platform.ts packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime-contracts.ts agent-docs/exec-plans/active/2026-05-22-r2-upload-timing-split.md`

## State

- Implemented. Production evidence showed total direct upload around several
  seconds while the Worker presign route itself was fast, so the new diagnostic
  logs split container-side presign and direct PUT elapsed milliseconds while
  preserving the existing total direct-upload timer.
Status: completed
Updated: 2026-05-22
Completed: 2026-05-22
