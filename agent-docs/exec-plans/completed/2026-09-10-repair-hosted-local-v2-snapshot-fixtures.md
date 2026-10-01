# Repair hosted-local snapshot fixtures for v2 restore

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

- Repair hosted-local E2E seeds after runtime restore retired legacy snapshots.
- Priority, ordering, and recovery fixtures must reach their assertions through
  genuine v2 encrypted workspaces, without changing production behavior.

## Success criteria

- One shared test-only helper composes current archive/encryption owners,
  authenticated runtime-envelope reads, local object upload, and locator marker.
- All hosted-local legacy producers use it while retaining scenario assertions.
- Focused proof restores the generated fixture through the real v2 restore owner.
- Relevant tests, Cloudflare typecheck, and complexity diff pass; a draft PR
  records any unavailable protected hosted journey evidence.

## Scope

- In scope: shared test helper, affected hosted-local fixtures, testing map,
  this plan, and Frog evidence.
- Out of scope: production runtime, session fences, Web crypto unwrap policy,
  deployment admission, schemas, dependencies, and private environment inputs.

## Constraints

- Use actual tar/zstd/AES-GCM bytes and wrapped keys, never relabeled bundles.
- Require loopback Web and explicitly local MinIO before authenticated reads.
- Test helpers remain outside the production import graph.
- Parent owns candidate review, Ready, ReviewGPT, merge, and rollout.

## Risks and mitigations

1. Invalid fixture encryption or object layout.
   Mitigation: compose real archive/crypto/storage owners and prove real restore.
2. Seeding changes ordering or recovery behavior.
   Mitigation: seed before any invocation and preserve assertions/receipt artifacts.
3. An upload failure publishes an invalid checkpoint.
   Mitigation: finish encrypted object upload and locator before checkpoint seed.

## Tasks

1. Inventory legacy producers and protocol owners.
2. Implement shared local-only v2 fixture upload.
3. Migrate callers and delete duplicate legacy constructors.
4. Verify focused restore, tests/types, and complexity.
5. Self-review, close plan, scoped commit, and draft PR.

## Decisions

- Legacy seeds use snapshotHostedExecutionContext and artifact-backed bundle
  refs; the current workspace restore explicitly requires v2 references.
- Existing artifact PUT does not store a native v2 object.
- Preserve pre-invocation setup. Reuse the existing Cloudflare authenticated
  runtime-envelope reader and signature/unwrap owner; do not teach Web to unwrap
  runtime roots or create a competing invocation to obtain a publication lease.
- Existing Web checkpoint seed stays the state owner; MinIO presigning and the
  existing direct-R2 locator marker stay the local object-store owners.

## Verification

- PASS: five focused shared-fixture tests exercise real signed-envelope verification, wrapped data keys, tar/zstd/AES-GCM construction, current v2 restore, local-only settings, upload-before-locator ordering, and upload failure. HTTP responses are synthetic.
- PASS: `pnpm --dir apps/cloudflare typecheck`; `pnpm complexity:diff --base d8b6cfcdbb2ce02f8646085146ebdfab2ac425b6` reports no authored production JS/TS changes.
- All twelve legacy E2E seed writers use one shared helper; retained scenario assertions and receipt artifacts are unchanged. No production source, routes, schemas, dependencies or deploy gates changed.
- The documentation index was updated to match the new fixture-proof entry; final docs/diff guards remain part of completion.
- Full hosted priority, ordering and recovery journeys were not run locally. Exact-head CI and managed production admission remain required; local encrypted restore proof does not replace those journeys.
- Final ReviewGPT runs in the background under release-owner authorization, with any findings handled after merge if necessary.
Completed: 2026-09-10
