# Hosted Snapshot Zstd Hard Cut

## Goal

Hard-cut v2 hosted workspace snapshots to `tar.zst` before gzip ships:

- new snapshots emit `archive.compression: "zstd"`
- restore accepts only zstd v2 snapshots
- the hosted runner image includes the `zstd` CLI
- tests prove the zstd-only direct-R2 snapshot path

## Constraints

- Keep the direct-R2 hard cut intact: no Worker body upload path, no multipart, no artifact sidecars.
- Keep the implementation a simple Unix pipeline, not a JS compression dependency.
- Do not add gzip compatibility because gzip v2 snapshots have not deployed.
- Preserve unrelated active hosted-runner and web worktree edits.
- Do not expose local paths, user ids, raw snapshot contents, secrets, or provider payloads.

## Working Set

- `packages/hosted-execution/src/workspace-snapshot-v2.ts`
- `packages/hosted-execution/src/parsers/workspace-snapshot-v2.ts`
- `packages/hosted-execution/test/workspace-snapshot-v2.test.ts`
- `apps/cloudflare/src/workspace-snapshot-local.ts`
- `apps/cloudflare/test/workspace-snapshot-local.test.ts`
- `apps/cloudflare/test/{runner-platform,runner-outbound,user-runner-alarm,hosted-runtime-checkpoint-baseline-e2e,runtime-bridge-workspace,direct-r2-hard-cut-guard}.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-restore-codex-continuity.test.ts`
- `Dockerfile.cloudflare-hosted-runner-base`

## Verification Plan

- Focused hosted-execution and Cloudflare snapshot tests.
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm --dir apps/cloudflare verify` or full `pnpm verify:acceptance`
- `pnpm hosted-local e2e`
