# Device runtime apply bounds

Status: active
Created: 2026-08-11
Updated: 2026-08-11

## Goal

Bound database and KMS work in the signed hosted device-sync runtime apply path
without weakening its live connection, credential, lease, source, or provider-
application authority checks.

## Success criteria

- Each runtime apply entry admits an explicit, protocol-owned maximum number of
  source updates and rejects overflow before opening a transaction.
- Candidate connection, source, and crypto material is prepared outside the
  per-connection mutation transaction with set-based reads and existing bounded
  secure-box primitives.
- The existing advisory-lock transaction remains the linearization point and
  revalidates every live ownership, epoch, version, lease, disconnect, source,
  ciphertext, and root fence before writing.
- No database transaction or connection mutation lock remains active while KMS
  or other external crypto-provider work executes.
- Duplicate account/source hydration is removed, and the apply response is
  derived from the live or write-returned state without a second rich decrypt.
- Deterministic maximum-cardinality tests and a focused local-PostgreSQL replay
  prove the bounded query, KMS, transaction, and connection-pool shape.

## Constraints

- `apps/web` remains the canonical hosted device-sync control-plane owner.
- Keep per-connection serialization and all existing fail-closed authority
  behavior; preparation is candidate evidence, never write authority.
- Reuse the current Prisma store and hosted secure-box owners. Do not add a
  queue, cache owner, global semaphore, service, dependency, or generic
  abstraction.
- Never silently truncate source updates or expose credentials, ciphertext,
  private identifiers, or provider payloads through logs, tests, or docs.
- Keep the patch isolated from the other database-fanout audit lanes.

## Tasks

1. [x] Inspect the current runtime apply path, source parser, crypto/store
   owners, authority fences, and focused test seams.
2. [x] Ask a dedicated ReviewGPT implementation lane for a complete scoped
   patch attachment and arm the normal wake flow.
3. [x] Inspect the returned patch completely, scan its paths and privacy
   boundary, and deliberately apply only accepted hunks.
4. [x] Prove source overflow, maximum update cardinality, KMS/transaction
   ordering, prepare-to-commit races, and local PostgreSQL pool behavior.
5. [ ] Run focused tests, routed typecheck/lint, diff/privacy checks, and the
   required exact-head specialist and final ReviewGPT gates.
6. [ ] Close this plan through `scripts/finish-task`, push the reviewed head,
   and wait for exact-head required CI to pass.

## Decisions

- ReviewGPT's third regenerated attachment was non-empty, path-scoped, free of
  privacy or secret material, and applicable to the rebased tree. The local
  artifact was 98,825 bytes with SHA-256
  `e4c04e56ee6deb2593b7b6b76af4f10420ecb56dda6e5f7220d279e9cb1ec8cf`;
  ReviewGPT reported different size and digest metadata, so every hunk was read
  directly and the local artifact was treated as untrusted implementation
  intent rather than as a verified binary handoff.
- Accepted the two-phase prepare/commit structure, bounded source protocol,
  set secret operations, active-root check, live authority revalidation, and
  removal of post-write hydration. Rejected ReviewGPT's whole-row `updatedAt`
  and whole-source-set equality gates because they exceeded the API's existing
  field-specific live fences and would reject composable writes after unrelated
  state drift. The implementation keeps the narrow connection epoch, observed
  row/source/token versions, ciphertext, lease, disconnect, provider-
  application, and active-root fences.

## Verification

- `packages/device-syncd/test/hosted-runtime.test.ts`
- `packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts` when the
  shared protocol bound changes runtime batching behavior
- `apps/web/test/device-sync-hosted-runtime-authority.test.ts`
- Focused Prisma connection/secret/source store tests touched by the patch
- Focused local-PostgreSQL runtime-apply replay with a 15-connection pool
- Hosted-Web and affected workspace-package typechecks plus scoped lint
- `git diff --check`, privacy/path inspection, exact-head ReviewGPT gates, and
  required GitHub checks

## Verification results

- Runtime protocol: 95 focused tests pass on the current merged base, including
  the 64-source rejection before any control-plane work.
- Runtime authority and prepared-secret owners: 67 focused tests pass. The
  deterministic 100-update cases prove two set reads, one batched secret read,
  one optional batched preseal, serial transaction concurrency of one, no
  post-write hydration, and no KMS/provider work inside a transaction.
- Shared crypto-root owner and adjacent connection-lock/source coverage pass 44
  current-base tests, including root-reference
  deduplication, provider unwrap concurrency no greater than four, full
  in-flight chunk settlement on failure, and root-key zeroization. Earlier
  adjacent connection/source/OAuth coverage also passed 56 tests.
- Assistant runtime passes 85 hosted device-sync runtime tests on the current
  merged base; Hosted Web and device-syncd typechecks pass; full Web lint has
  zero errors; repository source/artifact, docs-drift, diff, and privacy guards
  pass.
- A fresh, fully migrated local PostgreSQL cluster passed both proofs: the
  1,641-receipt, 31-wide incident replay stayed within the 15-connection pool,
  and a 100-update no-op apply plus 40 foreground reads stayed within a
  two-connection pool with one set connection read, one set source read, 100
  serial live connection/source reads, and zero writes.
- Broad diff verification passed repository guards, all affected typechecks,
  and the full assistant-engine (3,468), assistant-cli (128),
  assistant-runtime (2,165), and assistantd (40) test inventories before stale
  CLI runtime artifacts caused unrelated command timeouts and a sleeping worker
  chain. A freshly prepared detached base passed the isolated CLI file 38/38;
  `pnpm build:test-runtime:prepared` then made the changed worktree pass the
  same file 38/38. After merging current `main`, the prepared runtime build and
  isolated CLI file again pass 38/38. The reproducible verification-owner gap
  is recorded through Frog; exact-head CI owns the broad PR suite.
