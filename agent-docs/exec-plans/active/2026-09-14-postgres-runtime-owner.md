# Replace UserRunner coordination with Postgres authority

Status: active
Created: 2026-09-14
Updated: 2026-09-15

## Goal

- Replace per-member UserRunner Durable Object coordination with Web/Postgres
  authority, reducing avoidable startup and callback dispatch while preserving
  message delivery, recovery, and resource ownership.

## Success criteria

- One authority admits and fences runtime attempts. Competing claims, revocation,
  completion, and publication preserve ordering under independent connections.
- The steady-state path no longer activates UserRunner. Container lifecycle
  remains with the native Cloudflare container adapter.
- Snapshot, media, deletion, and uncertain external effects retain their
  ownership checks and recovery behavior.
- A finite cutover preserves existing resources and active runtimes across
  supported Web/Worker/Temporal deployment skew.
- Focused tests, typechecks, parent review, required final ReviewGPT, and
  exact-head CI pass before declaring the candidate complete.

## Scope

- In scope: authority schema and transactions; runtime and resource adapters;
  callback authentication; production cutover; owner documentation and proof;
  heartbeat/presign simplifications useful under the resulting design.
- Out of scope: replacing Temporal or native container Durable Objects; adding
  another scheduler; unrelated model/provider or mailbox optimizations.

## Constraints

- Keep transactions short and database-only. Preserve distinct attempt,
  generation, workspace version, container binding, and liveness facts.
- No permanent dual authority, remote wrapper for every old store accessor,
  positive authority cache, or private source mirror.
- Preserve wrong-member and replay rejection, signed authority fields, consent
  revocation, paused retention, and exact-target cleanup.
- Never infer stopped execution from a timeout alone. Preserve idempotency,
  ambiguous-effect receipts, and outstanding upload drains.
- Preserve unrelated checkouts. Keep production evidence aggregate-only.

## Risks and mitigations

1. Competing or stale runtimes publish after replacement.
   Mitigation: atomic admission and publication checks at the database owner,
   proved with independent-connection tests and controlled barriers.
2. Cutover discards legacy resource state or admits both authorities.
   Mitigation: explicit drain/migration proof and supported deployment order.
3. Removed checks weaken authorization around external work.
   Mitigation: retain final ownership checks and drain registration at effect
   boundaries; verify late callbacks and deletion races.
4. Moving coordination adds latency or database pressure.
   Mitigation: report composed call counts and timing boundaries; distinguish
   local proof from measured production improvement.

## Tasks

1. Receive ReviewGPT's concrete implementation plan, based on its inspection
   of the pinned public source and private Temporal consumer.
2. Validate that plan against current source, ownership, migration, and
   remaining UserRunner dependencies. Preserve intervening main changes.
3. Implement locally in independently verified slices, using the smallest
   maintainable design and this plan as the durable task owner.
4. Run focused owner, independent-connection Postgres, auth, failure, and
   successful message/typing proof plus affected typechecks.
5. Review candidate, measure complexity, document deployment and changelog
   disposition, then commit and open a scoped PR.
6. Start required final ReviewGPT concurrently with exact-head CI. Resolve
   proven issues under the completion workflow and report the shipped result.

## Implementation progress

- ReviewGPT returned the requested implementation plan. Its five source slices
  are transactional ownership/authentication; canonical publication/usage;
  launch/recovery; resource effects; and integration/deletion/observability.
  A controlled fleet drain and resumable resource import precede activation.
- The task branch was advanced to current main before implementation, preserving
  warm mailbox crypto-context reuse and the small-runner experiment removal.
- Added an FK-free runtime owner and finite cutover gate. The additive migration
  defaults to legacy authority; new Postgres claims remain disabled until the
  cutover command proves readiness.
- Added short, conditional owner transitions and signed callback identity using
  the existing signed query material. No new signature format is required.
- Checkpoint and browser-vault publication share a transaction with runtime
  authority. Usage settlement revokes managed-AI permission in its transaction.
  Composed checkpoint/revocation proof and 157 existing route/usage tests passed.
- Native invocation receipts retain launch uncertainty and completed generations
  across eviction. A proved completed invocation can release authority while
  preserving its exact warm assignment. Thirteen independent-connection owner
  tests and two native receipt tests passed.
- Extracted existing invocation preparation and preserved 40 transport/snapshot
  tests. Request-local launch/reconciliation is implemented; integration and its
  focused proof are in progress. Mailbox publication is moving into the owner
  transaction, with crypto and optional presentation outside the transaction.
- The uncommitted owner migration was consolidated before publication to satisfy
  the additive predeploy migration policy, then reapplied only to the synthetic
  task database. No deployed migration history changed.
- Resource migration, remaining effect authorization, cutover tooling, deletion,
  and end-to-end product proof remain unfinished. Activation stays disabled.
- Mailbox regression proof passed all 110 tests with authority and database
  work in one transaction. Both affected app typechecks passed that slice.
- Nine native supervision/orchestration tests passed, including actual adapter
  receipt recovery after lost launch/completion acknowledgment. The ensure route
  now calls the request-local owner and retains its finite legacy fallback.
- Added FK-free resource tables and transactional snapshot commands. Migration
  and Prisma generation passed locally. Fifteen Postgres tests now include final
  PUT admission versus revocation and drain/orphan survival after deletion.
  Worker resource integration, media/replica owners, and cleanup are in progress.

## Decisions

- The user chose a production implementation after architecture review.
- Smaller improvements belong in the Postgres design; avoid a temporary
  optimization PR for the coordinator being removed.
- ReviewGPT received current public source and the actual private Temporal
  implementation and replay tests. No production mutation is part of patch
  generation.
- The external implementation attempt returned no patch. The user requested
  an implementation plan followed by local implementation and verification.
- Main has since gained warm mailbox crypto-context reuse and removed the
  small-runner experiment; both changes must be preserved.

## Verification

- Focused suites follow the returned plan and actual changed owner paths.
- Required database scenarios: claim/claim, checkpoint/revoke,
  completion/replacement, rollback, stale callback, and admission/auth failures.
- Required lifecycle scenarios: lost launch acknowledgment, uncertain stop,
  replacement, late completion, deletion/resource races, and normal delivery.
- Expected outcome: tests exercise actual composed owners rather than copies of
  implementation; all unavailable live proof is stated explicitly.
- Local PostgreSQL is reachable. Workspace dependencies are installed with the
  frozen lockfile. Shared package compilation completed; the initial root build
  reached CLI packages omitted by the scoped install, then those packages and
  the CLI assembly passed after the full install. These are preparation results;
  no implementation tests have run yet.
- Baseline `pnpm --dir apps/cloudflare typecheck` and
  `pnpm --dir apps/web typecheck` passed before patch integration.
- All 222 baseline Web migrations applied successfully to a newly created,
  task-owned loopback PostgreSQL database. No production or shared development
  database was mutated.
- The new owner migration also applied locally; Prisma validation and client
  generation passed. The hosted-execution package build and affected Web and
  Cloudflare typechecks passed for the first ownership slice.
- First proof: 21 ownership/auth tests passed. Strengthened ownership proof then
  passed all 10 tests, including observed PostgreSQL lock contention and a
  consent/claim race. Publication integration requires its own rerun.

## Resource ownership progress

- Snapshot upload sessions, independent PUT drains, typed orphan candidates,
  and media retirement metadata now have FK-free Postgres owners. The resource
  migration applied in the isolated synthetic database.
- Canonical snapshot/replica publication rejects retired resource identities
  within the owner transaction and retains cleanup obligations on publication.
  Legacy snapshot tombstones identify shared bundle payloads independently.
- Media retirement is terminal. A late upload re-arms cleanup with a new revision;
  an earlier purge acknowledgement cannot discharge that obligation. Metadata
  and conditional purge acknowledgement remain available after member deletion.
- Existing external retention now claims bounded resource cleanup and uses a
  member-bound Worker endpoint for physical R2 deletion. Snapshot and replica
  namespace checks and interrupted replica deletion have focused Worker proof.
- A temporary fleet-wide deployment switch selects the Postgres implementation.
  Deploy it enabled only while the durable gate is draining, after stopping and
  importing the frozen legacy owners; then activate the durable Postgres gate.
  A mismatch between the deployment switch and gate blocks new starts. Remove
  the switch with the migration-only namespace after inventory and rollback proof.
- Local proof so far: 18 real Postgres tests passed; 112 mailbox/retention tests
  passed; five physical cleanup/storage-path tests passed. Shared packages built.
  Cloudflare typecheck passed before the latest cutover/media caller wiring.
  Web typecheck found client fixture omissions; those fixtures were updated and
  require a rerun. These are implementation checkpoints, not release readiness.
- Still required: finish snapshot/replica callers and capability drain lifecycle;
  durable unknown-usage settlement; provider/completion/native retirement callers;
  deletion reconciliation; legacy freeze/export/import and inventory-gated cutover;
  removal of steady UserRunner ownership; full composed message/typing proof,
  owner documentation, candidate review, scoped commits, and final review/CI.

## User controls and failure proof

- Native usage receipts now close the unknown-settlement window before Web
  forwarding. Pending receipts survive adapter eviction and block managed
  providers while settlement/revocation responses remain uncertain.
- Provider admission validates the persisted target or token hash with current
  membership. Native completion and exact-target retirement use Postgres;
  delayed retirement cannot clear a replacement assignment.
- Replica writes have independently releasable identities. Media PUT admission
  records provisional resource metadata and an independent drain before R2.
  Uncertain media writes remain held; their bounded operational reconciliation
  still needs completion before activation.
- Status and consent controls now use Web/Postgres and native targets. Account
  deletion waits for absent membership, stopped targets, and all PUT drains;
  it reports Postgres cleanup honestly without claiming legacy DO deletion.
- Cleanup claims honor the retention wall-time budget. Retired media retries
  use the existing metadata timestamp to avoid starving other expired rows.
- Snapshot commands validate the derived member namespace. Ordinary signed
  callbacks check fresh ownership; legacy runtime headers cannot bypass the
  Postgres gate after activation.
- Latest focused proof: 22 real Postgres tests; 43 Cloudflare orchestration,
  user-control, usage, and transport tests; 14 callback-auth tests. Both app
  typechecks pass. The complexity guard passes after separating launch,
  reconciliation, usage forwarding, and transactional resource commands.
- The user authorized opening a PR and reaching final ReviewGPT green. This is
  an intermediate verified checkpoint; the plan remains active and the PR stays
  draft. Required remaining work includes the frozen legacy export/import and
  inventory gate, private-media publication, uncertain direct-write recovery,
  owner documentation/telemetry, composed warm/cold message and typing proof,
  private Temporal compatibility proof, and final exact-head review/CI.


## Frozen legacy migration checkpoint

- The legacy wrapper now persists a closed freeze barrier before stopping its
  exact target, waits for admitted RPCs and background work, reconciles again,
  verifies capability drains, and removes queued alarms before export. SQLite
  schema 20 rejects older writers that do not implement the freeze protocol.
- Bounded export covers media-only and empty objects, resource metadata, and
  generation high-water. Unknown KV state fails coverage. Active credentials,
  attempts, and inference envelopes are never exported as authority.
- The signed system migration endpoint owns a monotonic draining gate, ordered
  namespace inventory, exact-page hash/cursor receipts, and atomic resource
  import. Deleted members need no canonical member row. Activation requires
  completed imports and the same final inventory; it cannot restore legacy
  authority. The migration namespace remains retained through rollback proof.
- The hosted operator helper inventories the actual Cloudflare namespace with
  pagination and requires one serving Worker version at 100% traffic. It reads
  every object, including objects without stored data, and separates import from
  explicit activation. No production invocation or deployment occurred.
- Migration proof passes on real loopback Postgres: replay, stale cursor/hash,
  terminal media retirement, empty-object coverage, incomplete activation, and
  generation 17 -> 18 after cutover. Legacy export/freeze and operator tests pass.
- Private Temporal consumer typecheck and 485 focused orchestration/replay tests
  passed against its unchanged source and exact published dependency. This is
  compatibility evidence, not a composed new-public/private live delivery proof.
- Private-media publication and independent recoverable multipart receipts for
  media/private images/replica shards are implemented. Unknown aborts remain
  pending through runtime stop and account deletion. Five physical-upload tests,
  23 real-Postgres ownership tests, 99 harness environment tests, and Web/Worker/
  harness typechecks pass. The full runner bundle passes its local size guard.
- The dedicated Postgres cold/warm full-stack journey is running. Its isolated
  schema-reset fixture now initializes the empty cutover row explicitly.
- Remaining work includes final steady-state cleanup, telemetry review, composed
  warm/cold reply and typing proof, deployment-variable forwarding in the private
  consumer, final ReviewGPT, and exact-head CI. PR #3479 remains draft.


## Final review scope requested by the user

- When the implementation and focused proof are complete, run five ReviewGPT
  audits concurrently: two independent full reviews, plus focused runtime
  ownership, migration/cutover, and upload/cleanup lifecycle reviews.
- Report each audit's actual findings to the user, including zero-finding
  results, and remediate confirmed issues. These are explicitly requested final
  audits; do not start them while implementation changes are still known.

## Composed delivery and completion checkpoint

- The first composed fixture omitted member activation; it now initializes the
  canonical vault before testing a cold conversation. No product change was
  made for that unsupported fixture state.
- The composed run exposed a missing opaque provider token in the new launch
  adapter. Preparation now stores its hash in Postgres and carries the raw token
  only in the launch job. Cold and second replies and typing-before-send then
  passed; the same-target assertion correctly caught the remaining warm issue.
- Native completion previously left the owner retiring until reconciliation or
  idle shutdown. The settled outer invocation now releases the attempt while
  retaining its warm target before notifying Temporal. Early completion callbacks
  still retain authority until native settlement. Thirteen focused native and
  orchestration tests pass. The full composed journey passed: cold delivery,
  warm typing-before-send, the same native target, clean mailbox progress, and
  no provider authorization failures or harness interventions.
- Phase-only failure metadata records the first failure of an exact attempt
  before native stop. Duplicate and delayed reports cannot change a successor.
  All 24 Postgres ownership tests pass. Both app typechecks, shared build, the
  five usage tests, 85 harness startup tests, harness typecheck, migration proof,
  and 23 freeze/import/resource/user-control tests pass.
- Local schema pushes now initialize the legacy gate idempotently; production
  migration ownership and fail-closed missing-gate behavior remain intact.
- Private deployment companion PR: https://github.com/cobuildwithus/murph-cloud/pull/151.
  Its full verification and 63 focused environment-contract tests passed.
  Its two mandatory external reviews run alongside CI and are additional to
  the five requested public lifecycle audits. No production deployment occurred.
- Owner documentation now describes steady Postgres authority, bounded upload
  recovery, and the separately authorized finite cutover. No prompt, tool schema,
  provider-visible input builder, or group runtime was changed. Model-quality
  live proof is not selected for this orchestration change; the composed journey
  uses the real Codex app-server/runtime with synthetic provider responses.
