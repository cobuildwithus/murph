# Hosted-local snapshot restore discovery

Status: completed
Created: 2026-08-06
Updated: 2026-08-06

## Goal

- Make a hosted-local runner cold-restore a successfully published v2 workspace
  snapshot from the same MinIO bucket that received the direct presigned upload.

## Success criteria

- Hosted-local presign GET discovery uses the configured local S3 control
  endpoint and does not consult the separate Wrangler R2 binding.
- Production R2 source/destination lookup and cutover fallback behavior remain
  unchanged.
- A focused test reproduces the current 404 and proves the corrected source and
  destination bucket selection.
- Cloudflare focused tests, typecheck, exact-head CI, and required ReviewGPT
  gates pass before merge.

## Scope

- In scope: workspace-snapshot presign GET object discovery, focused Worker
  regression coverage, and the existing public PR verification package.
- Out of scope: snapshot format, upload/session ownership, production bucket
  migration behavior, retry policy, Durable Object state, or deployment config.

## Constraints

- Preserve the existing exact ref, namespace, and write-fence validation before
  any object lookup.
- Keep local endpoint authority behind the existing hosted-local-only env guard.
- Do not add persisted state, a compatibility service, or a second snapshot
  source of truth.

## Risks and mitigations

1. Local lookup could accidentally alter production bucket selection.
   Mitigation: branch only when the existing local endpoint guard resolves a
   local S3 store; otherwise call the unchanged production locator.
2. Cutover tests could lose source/destination parity.
   Mitigation: exercise local destination fallback as well as the single-source
   path and retain the existing production cutover tests.
3. A missing local control endpoint could become a silent 404.
   Mitigation: retain the existing fail-closed configuration error.

## Tasks

1. Add a failing hosted-local presign GET regression test.
2. Route local discovery through the existing local S3 HEAD adapter.
3. Run focused Worker tests and Cloudflare typecheck.
4. Update the pushed PR evidence and complete ReviewGPT plus exact-head CI.

## Decisions

- Reuse the local S3 object-store adapter already used by snapshot completion
  and cleanup; MinIO remains the sole hosted-local owner of directly uploaded
  snapshot bytes.

## Verification

- Before the implementation change, the focused hosted-local restore test
  failed because the presign GET path called the Wrangler R2 binding's `head`
  method instead of the configured local S3 control endpoint.
- `pnpm --filter @murphai/cloudflare-runner exec vitest run test/runner-outbound.test.ts`
  passes all 212 tests, including single-source and source-active destination
  fallback restore discovery.
- `pnpm --filter @murphai/cloudflare-runner typecheck` passes.
- `git diff --check` passes.
- Exact-head CI and ReviewGPT remain required before merge.
Completed: 2026-08-06
