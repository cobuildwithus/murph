# R2 OC/ENAM zero-downtime bridge

Status: completed
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Integrate the returned Pro draft for the hosted execution R2 OC-to-ENAM
  bridge into the current checkout without blindly applying malformed hunks.
- Preserve existing hosted runtime, direct-R2 snapshot, and account-deletion
  ownership while making the source-active and destination-active cutover
  phases explicit and test-covered.

## Success Criteria

- Cloudflare runtime code can resolve fixed-role `BUNDLES` (source/OC) and
  `BUNDLES_ENAM` (destination/ENAM) bindings with a required phase when both
  bindings are configured.
- Source-active mode remains OC-only for ordinary reads, writes, lists, and
  deletion begins with OC. Destination-active mode writes to ENAM and reads
  ENAM first, falling back to OC only after definitive absence.
- Direct-R2 snapshot upload sessions are bucket-affine and compatible with old
  OC-only sessions; completion and presigned GET use the same resolved object
  role.
- Account deletion reports success only after both configured buckets, runner
  cleanup, and Durable Object storage cleanup converge; direct PUT upload
  ambiguity remains retryable for the documented drain window.
- The online copy helper can copy only immutable, current-member-owned
  canonical v2 snapshot objects with source/destination preconditions and no
  prune, overwrite, or lifecycle-managed object authority.
- Focused Cloudflare tests, diff-aware verification, required audit/review
  gates, and deployment notes cover the change.

## Scope

- `apps/cloudflare` R2 cutover helpers, direct-R2 presigned URL/session paths,
  account-deletion cleanup, worker status telemetry, deploy config rendering,
  R2 online-copy scripts, runbook docs, and focused tests.
- `packages/hosted-execution` runtime-control parser contract needed for
  status telemetry.
- `packages/hosted-local-harness` local-dev `wrangler`/MinIO env generation
  needed to keep local Worker bindings aligned with the fixed-role bridge.
- Cloudflare deployment docs for the temporary bridge and safe cutover order.

## Constraints

- Treat the downloaded patch as untrusted implementation intent, not overwrite
  authority.
- Do not touch hosted Web Prisma work or unrelated active lanes.
- Do not add a coordinator, lock service, queue, journal, tombstone, merged-list
  adapter, dual writes, or destination prune.
- Do not expose object keys, credentials, bucket names from a real environment,
  local paths, or private identifiers in durable artifacts.
- Keep rollback and deploy-skew behavior explicit for Worker/container and
  bucket-role disagreement.

## Tasks

1. Inspect and rebase the Pro patch onto the current Cloudflare sources.
2. Apply clean hunks where they still match, then manually integrate the
   rejected/mismatched hunks against current code.
3. Review the resulting implementation for source/destination ownership,
   upload-session affinity, account-deletion partial failure behavior, and copy
   preconditions.
4. Run focused Cloudflare tests and the canonical diff-aware verification lane
   for touched owners; document any unrelated blockers.
5. Complete the required local review/audit path, close the plan, and create a
   scoped commit.

## Evidence

- The retained Pro response states the draft was based on commit
  `0c47782e3cfd6a6e0118a01367e93e495ef6ed58` and is not apply-ready.
- `git apply --check` against the current checkout rejects multiple hunks,
  including current direct-R2 presign/session, account-deletion, outbound,
  wrangler, and cleanup-test paths.
- The repository head for this task is newer, so the bridge must be integrated
  by reading the current owner code rather than forcing the patch through.
Completed: 2026-07-28
