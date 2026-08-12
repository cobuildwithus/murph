# Device runtime apply bounds

Status: active
Created: 2026-08-11
Updated: 2026-08-12

## Goal

Bound database and KMS work in the signed hosted device-sync runtime apply path
without weakening its live connection, credential, lease, source, or provider-
application authority checks.

## Success criteria

- Each runtime apply entry admits an explicit, protocol-owned maximum number of
  source updates and rejects overflow before opening a transaction.
- Candidate connection and crypto material is prepared outside the
  per-connection mutation transaction with one owner-filtered set read and
  existing bounded secure-box primitives; source authority is read only at the
  live transactional fence.
- The existing advisory-lock transaction remains the linearization point and
  revalidates every live ownership, epoch, version, lease, disconnect, source,
  ciphertext, and root fence before writing.
- No database transaction or connection mutation lock remains active while KMS
  or other external crypto-provider work executes.
- Duplicate account/source hydration is removed, and the apply response is
  derived from the live or write-returned state without a second rich decrypt.
- Deterministic maximum-cardinality tests and a focused local-PostgreSQL replay
  prove the bounded callback-body, query, KMS, transaction, and connection-pool
  shape.

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
- The preliminary ReviewGPT specialist pass returned three coverage findings
  and no patch artifact. Accepted all three as test-only evidence gaps: exact
  foreground overlap while the first advisory-lock transaction is held, the
  composed 100-by-64 source-write shape, and the prepared-token store owner.
  Reused the existing transaction spy, fanout harness, and Prisma store
  fixtures; no production or generic test abstraction changed.
- The original-head final ReviewGPT audit found two architecture collapses at
  `c6da9526edd3`: the prepared source snapshot had no semantic consumer and
  duplicated the live transactional source read, while runtime apply had
  reimplemented active-root SQL already owned by hosted crypto. Accepted both.
  Deleted the source set read/grouping/prepared field, retained every live
  source fence, and replaced the feature-local SQL with
  `lockAndReadActiveHostedDomainRootKeyIdTx`. The canonical owner now takes the
  same authority lock as provisioning before token persistence. Review thread:
  `https://chatgpt.com/c/6a7b1deb-1a20-83ea-ba41-ad88073d5764`.
- The concurrent corrected-head final accepted its prompt but failed response
  capture at `c6da9526edd3` in thread
  `https://chatgpt.com/c/6a7b2545-9cd4-83ea-aa7b-f9d900b07b05`. That stale
  snapshot is non-terminal after the accepted production remediation; a fresh
  exact-head full audit owns the final verdict.
- The fresh exact-head final at `9ef5f44d5a5d` returned one valid finding:
  the claimed 100-by-64 source shape bypassed the production callback body
  limit because the direct authority test never crossed the Cloudflare/Web
  request boundary. Accepted. The fix keeps ownership in the existing
  Cloudflare device-sync port, which already constructs the final signed
  callback envelope: it partitions ordered runtime-apply updates by both the
  100-update protocol cap and the shared 256 KiB serialized body cap, sends the
  callbacks serially, aggregates ordered responses, and rejects one
  independently oversized update before retry loops. The Web route now imports
  the same protocol limit constant.
- The next exact-head ReviewGPT round at `e9b5c758729e` returned
  `RETROSPECTIVE_REQUIRED`, not a code finding. The retrospective decision is
  to continue with callback-body partitioning at the existing Cloudflare port.
  That is the smallest complete architecture because the admitted 100-by-64
  producer shape otherwise fails at the signed Web callback body gate before it
  can reach the database authority. Moving the bound upstream would either hide
  a valid producer shape or duplicate transport-envelope knowledge in the
  assistant runtime; moving it downstream cannot work because the Web route
  must reject oversized signed bodies before parsing and authority work. The
  accepted direction keeps exactly one new operational surface: byte-aware
  chunking inside the existing callback transport owner, using the same compact
  JSON body it sends. It deliberately does not add a queue, durable state,
  retry store, service owner, cache, semaphore, compatibility table, or raised
  body limit.
- Retrospective validation boundary: the final architecture remains two-phase
  prepare plus live transactional commit. The Cloudflare port owns body-size
  chunk construction, sequential callback dispatch, ordered aggregation, later-
  chunk failure propagation, and single-update oversize rejection. The Web route
  owns the shared 256 KiB signed-body gate. The Web database authority owns all
  live connection, token, lease, source, provider, ciphertext, and root fences,
  with no KMS/provider/rich hydration inside transactions. Future remediation
  may only shrink or clarify those owners; expanding beyond them requires a new
  retrospective.
- The first substantive round-three attempt at `e9b5c758729` required a
  completed architecture retrospective before further audit. The decision is
  to retain callback-body partitioning at the existing Cloudflare port. The
  first-reviewed-to-current direction removes the unused prepared-source owner
  and duplicate active-root policy while adding 195 lines of review-driven
  source churn (144 additions / 51 deletions), net 93 lines. The byte-aware
  chunker, ordered response aggregation, and partial-failure behavior are
  irreducible because the independently valid 100-update and 64-source bounds
  do not compose beneath the existing 256 KiB signed-envelope limit. Lowering
  either semantic bound to avoid envelope measurement would make supported
  authority unreachable; moving partitioning elsewhere would duplicate the
  final-envelope owner. The retained smallest architecture is one Cloudflare
  envelope owner that emits serial bounded callbacks, followed by the existing
  two-phase Web authority owner with canonical live fences and serial
  database-only transactions. Superseded preparation and duplicate root-policy
  paths remain deleted. Further expansion beyond byte partitioning, ordered
  aggregation, independently oversized-update rejection, and fail-closed
  later-chunk semantics requires a new retrospective.
- The exact-head round-four audit at `72efcd2aa4` accepted the retrospective
  and prior architecture corrections, then found one review-induced foreground-
  priority failure: split callbacks reused a per-request timeout and the
  system-mailbox signal did not reach the complete callback loop. Accepted.
  `runHostedDeviceSyncWakeLane` now owns the existing background-maintenance
  cancellation primitive for the entire lane, combining the outer abort,
  foreground-yield predicate, and one timeout. The system-mailbox path forwards
  its existing signal, the idle caller no longer adds a duplicate wrapper, and
  transport-wrapped aborts are recognized through their preserved cause. This
  adds no queue, retry state, service, lifecycle, or authority owner.

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
- Runtime authority and prepared-secret owners: 68 focused tests pass. The
  deterministic 100-update cases prove one owner-filtered connection set read,
  no prepared source hydration, one batched secret read,
  one optional batched preseal, serial transaction concurrency of one, no
  post-write hydration, and no KMS/provider work inside a transaction. The
  composed maximum proves 6,400 serial source upserts, 6,701 modeled database-
  owner operations, and transaction concurrency of one.
- Shared crypto-root owner and adjacent connection-lock/source coverage pass 44
  current-base tests, including root-reference
  deduplication, provider unwrap concurrency no greater than four, full
  in-flight chunk settlement on failure, and root-key zeroization. Earlier
  adjacent connection/source/OAuth coverage also passed 56 tests.
- Assistant runtime passes 85 hosted device-sync runtime tests on the current
  merged base; Hosted Web and device-syncd typechecks pass; full Web lint has
  zero errors; repository source/artifact, docs-drift, diff, and privacy guards
  pass.
- The direct OAuth connection-store suite passes 50 tests, including prepared
  token write/clear selected-row returns, obsolete-lease cleanup, and active-
  lease rejection without a write.
- A fresh, fully migrated local PostgreSQL cluster passed both proofs: the
  1,641-receipt, 31-wide incident replay stayed within the 15-connection pool,
  and a 100-update no-op apply plus 40 foreground reads stayed within a
  two-connection pool with one set connection read, 100 serial live
  connection/source reads, no prepared source hydration, and zero writes. A
  transaction barrier now holds the first advisory-lock transaction open while
  all 40 foreground reads finish through the other pooled connection and
  proves that no second apply transaction enters before release.
- After the final-audit architecture remediation, 120 affected runtime
  authority, secret-preparation, Prisma token-store, and canonical root-owner
  tests pass; Hosted Web typecheck and scoped lint pass. The matching-root proof
  asserts canonical root lock/read before token persistence, while stale and
  absent roots remain fail closed. A new fully migrated PostgreSQL cluster
  again passed both incident replays with the reduced 100-live-source-read
  shape and released its two-connection proof pool and local server cleanly.
- Broad diff verification passed repository guards, all affected typechecks,
  and the full assistant-engine (3,468), assistant-cli (128),
  assistant-runtime (2,165), and assistantd (40) test inventories before stale
  CLI runtime artifacts caused unrelated command timeouts and a sleeping worker
  chain. A freshly prepared detached base passed the isolated CLI file 38/38;
  `pnpm build:test-runtime:prepared` then made the changed worktree pass the
  same file 38/38. After merging current `main`, the prepared runtime build and
  isolated CLI file again pass 38/38. The reproducible verification-owner gap
  is recorded through Frog; exact-head CI owns the broad PR suite.
- After the exact-head body-limit finding, focused proof passes:
  Cloudflare device-sync port 3/3, including 100-by-64 serialized-body
  partitioning, later-split failure without a misleading complete response, and
  single-update oversize rejection; Web runtime-apply route plus authority
  68/68, including the shared route body limit and the existing live fences; and
  assistant-runtime hosted device sync 85/85, including a real producer-emitted
  source-heavy 100-update batch that exceeds the callback body limit and
  therefore requires the Cloudflare port partitioner. Affected Cloudflare, Web,
  device-syncd, and assistant-runtime typechecks pass. Diff-check and privacy
  scan are clean.
- The retrospective-only update changed documentation and PR review context
  only; no production or test code changed.
- The first round-three audit returned `RETROSPECTIVE_REQUIRED` rather than a
  code finding. The required original-versus-current comparison, continuation
  decision, retained/removed owner inventory, smallest architecture, and
  no-expansion validation boundary are recorded above and in the PR body.
- After the round-four foreground-priority finding, 92 focused assistant-runtime
  maintenance/event tests and all four Cloudflare device-sync port tests pass.
  The direct split proof holds callback two after callback one commits, aborts
  it through the shared lane signal, proves callback three never starts, then
  retries the full ordered snapshot and converges all 100 updates. A fake-timer
  proof shows a transport-wrapped in-flight request returns the existing
  yielded/retry disposition at one lane-wide deadline. Assistant-runtime and
  Cloudflare package typechecks pass. The diff-aware repository gate also passes
  the complete affected assistant-runtime inventory (2,185 passed, 4 skipped),
  Cloudflare Node inventory (2,402 passed, 2 skipped), and Workers-runtime
  inventory (10 passed), together with the routed architecture, logging,
  provider-request, dependency, and workspace-boundary guards. No-JS, docs-
  drift, diff, and privacy checks remain clean.
