# Resolve PR 883 Round 12 legacy checkpoint ownership

Status: completed
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Prove whether a current hosted member can retain a canonical workspace
  snapshot reference whose required R2 objects live outside the current
  `users/hsn_*/` namespace.
- If reachable, extend the temporary source-only gate to accept only exact
  legacy object keys reached from a current canonical snapshot reference.
- Preserve the Round 11 architecture: two stable source inventories, one
  canonical read-only query, in-memory derivation, and no observability-based
  correctness or new persisted state.

## Protected invariants

- Every current member’s canonical checkpoint remains copyable and restorable.
- Deleted-member and otherwise unreferenced legacy objects still block
  destination creation.
- Missing ownership, malformed canonical data, unstable inventory, pagination
  failure, or query failure remains fail-closed.
- Member ids, namespace ids, object keys, snapshot references, credentials, and
  database connection data never reach output or durable artifacts.
- Account deletion and runtime restore behavior remain unchanged.

## Tasks

1. Trace canonical `HostedWorkspace.snapshotRef` shapes through the schema,
   parser, restore path, bundle-store key compatibility, and current write path.
2. Reproduce the gate’s behavior for every reachable legacy full/base,
   base-plus-delta, and base-plus-hot reference shape.
3. If the finding is proven, reuse the lowest owning checkpoint parser in the
   temporary operator gate and extend the single read-only query only as needed
   to derive exact referenced legacy keys in memory.
4. Cover current HSN ownership, every supported canonical legacy shape,
   unreferenced/deleted-member legacy residue, malformed query data, unstable
   inventory, query failure, pagination failure, and identifier-free errors.
5. Update the runbook and PR retrospective, run focused and canonical
   verification, commit/push the exact remediation, and continue the
   exact-head ReviewGPT/CI loop without merging PR 883.

## Evidence and decision

- The canonical snapshot-reference parser, workspace restore path, and bundle
  store all deliberately retain support for legacy full, layered base-plus-hot,
  and working base-plus-delta checkpoints.
- A current `hosted_workspace.snapshot_ref` is therefore sufficient canonical
  ownership evidence for the exact legacy objects it reaches. Namespace-only
  ownership would reject a supported current checkpoint.
- The gate now reads the current member and left-joined canonical snapshot
  reference in the same source-only query, reuses the runtime parser, and keeps
  all derivation in memory.
- Current v2 references must match both their member id and derived HSN
  namespace. Legacy references admit only their exact supported object keys.
  Deleted-member, unreferenced, malformed, or missing checkpoint objects still
  block destination creation without exposing identifiers.
- The query projection was exercised through the Keychain-backed read-only
  production helper and returned parseable JSON rows without retaining or
  publishing row contents.

## Verification

- Focused migration tests:
  `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts
  apps/cloudflare/test/deploy-r2-bundles-migration.test.ts --no-coverage`
  (54 tests passed).
- Cloudflare typecheck: `pnpm --dir apps/cloudflare typecheck` (passed).
- Runbook shell syntax, owner-gate CLI help, stale-marker scan, and
  `git diff --check` (passed).
- Canonical diff verification: `pnpm test:diff` (passed; Cloudflare Node
  1,982 tests and Workers 2 tests passed).
- Canonical acceptance verification: `pnpm verify:acceptance` (passed,
  including workspace typechecks, package coverage, app verification, the web
  production build, Cloudflare Node 1,982 tests, and Workers 2 tests).
Completed: 2026-07-26
