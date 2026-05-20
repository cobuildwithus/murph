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
- `apps/cloudflare/src/r2-presigned-url.ts`
- `apps/cloudflare/src/runner-outbound.ts`
- `apps/cloudflare/test/workspace-snapshot-local.test.ts`
- `apps/cloudflare/test/{runner-platform,runner-outbound,user-runner-alarm,hosted-runtime-checkpoint-baseline-e2e,runtime-bridge-workspace,direct-r2-hard-cut-guard,r2-presigned-url,deploy-preflight}.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-restore-codex-continuity.test.ts`
- `Dockerfile.cloudflare-hosted-runner-base`
- `scripts/dev-hosted-local/{minio,stack,environment,constants,types}.ts`
- `scripts/dev-hosted-local/{minio,stack,environment}.test.ts`
- `apps/cloudflare/{README,DEPLOY}.md`
- `agent-docs/operations/verification-and-runtime.md`

## Verification Plan

- Focused hosted-execution and Cloudflare snapshot tests.
- Focused hosted-local MinIO/presign/deploy-preflight tests.
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm --dir apps/cloudflare verify` or full `pnpm verify:acceptance`
- `pnpm hosted-local e2e`

## Current Follow-Up State

- Direct PUT presigns bind the checksum and production metadata headers in `X-Amz-SignedHeaders`.
- Hosted-local direct-R2 E2E now sends the production-shaped checksum and metadata headers and rejects missing/mutated signed headers.
- Restore validation uses one zstd/tar listing pass plus one extraction pass; post-extract durable-root preflight remains the byte-count guard and enforces an entry cap.
- v2 gzip refs remain intentionally unsupported because this v2 snapshot format is greenfield.
- Follow-up verification passed:
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/r2-presigned-url.test.ts apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/workspace-snapshot-local.test.ts apps/cloudflare/test/runner-platform.test.ts --testTimeout=30000`
  - `pnpm --dir apps/cloudflare verify`
  - `pnpm --dir packages/hosted-execution test -- workspace-snapshot-v2`
  - `pnpm hosted-local e2e direct-r2-presigned-put`
Status: completed
Updated: 2026-05-20
Completed: 2026-05-20
