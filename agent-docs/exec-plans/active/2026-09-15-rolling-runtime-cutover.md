# Rolling hosted runtime migration without a fleet pause

Status: active
Created: 2026-09-15
Updated: 2026-09-15

## Goal and invariants

Implement member-scoped migration, obtain passing final ReviewGPT and exact-head
CI, merge and deploy, and migrate every legacy object without a planned
fleet-wide admission pause. Preserve accepted work, canonical workspace state,
consent, deletion, effect receipts and resource obligations. Exactly one backend
admits each member's effects. Unknown launch, stop and effect outcomes never
grant replacement authority.

## Existing owners and proven gap

Extend Web's existing FK-free HostedRuntimeOwner; UserRunner remains the finite
legacy bridge. Keep native RunnerContainer execution and Temporal scheduling.
The global adapter switch, singleton draining gate, exclusive per-page gate lock
and fleet-wide activation predicate currently prevent rolling handoffs. The
operator stops at its first draining object. Upload capabilities outlive upload
completion; the current migration stop destroys rather than gracefully checkpoints.

## Decisions

- Explicit member migration state and operation identity; imported owner-row
  existence never activates execution. No dual writes or new runtime scheduler.
- One member-aware route decision with destination-side fencing for execution,
  canonical callbacks, provider effects, resources, native slots and user controls.
- Observational preparation followed by a conditional local readiness barrier.
  Preserve pending-operation accounting, repeated exact-target stop, frozen
  export hashes/cursors, resource tombstones and generation high-water.
- Graceful checkpoint before stopping a busy member; new work remains queued.
  Activation leaves a durable wake for the existing scheduler.
- Preserve upload deadlines. Implement a controlled checkpoint-upload path or
  equivalent proved mechanism for busy members; leaving them indefinitely on
  legacy does not complete the objective.
- Account for empty, deleted, resource-only and group objects. Close new legacy
  object creation separately from execution. Final closure permits active
  Postgres members and verifies no remaining legacy authority.
- Member-scoped locks and resumable recovery; no global exclusive lock per page.
  Freeze requires roll-forward recovery, never timeout-based rollback.
- Temporary compatibility is removable only after complete inventory accounting,
  Postgres activation and absence of legacy traffic.

## Product UX

Outcome: correct replies continue throughout the campaign; only a member's own
handoff may briefly defer queued input. Cover idle/busy personal members, groups,
new signups, consent/deletion and operator failure. Verify checkpoint continuity,
accepted-message replay, cold/warm replies, effect deduplication, cleanup and
unrelated-member admission. A sub-ten-minute target needs measured headroom;
passing a timer never substitutes for safe handoff evidence.

## Tasks

1. [in progress] Revalidate state; add explicit member migration contracts,
   schema, locks and readiness evidence.
2. [in progress] Implement all member routing, graceful/conditional handoff,
   controlled upload/drain behavior and durable activation wake.
3. [in progress] Implement hosted resumable operator, source discovery and creation
   barrier, new-member routing and full campaign closure.
4. [pending] Focused race/crash tests, typechecks and composed rehearsal.
5. [pending] Candidate/privacy/complexity review, owner docs, changelog decision,
   PR, green exact-head CI and final ReviewGPT.
6. [pending] Merge and compatible Web/schema/Worker deployment; verify serving
   versions and inactive campaign before canary.
7. [pending] Canary, full inventory migration including busy members and held
   obligations, and final live outcome verification.

## Verification

Use synthetic fixtures in artifacts; retain only aggregate content-free live
proof. Exercise stale routes, canonical transaction races, in-flight external
operations, new work, lost responses, imports, activation, consent and deletion.
Required final proof: deployed source/schema/configuration, complete namespace
accounting, zero legacy execution ownership, correct migrated cold/warm replies,
and no planned fleet pause. An operator success or green CI alone is insufficient.

## Progress

- Design consultation supports member-scoped migration and rejects unproved
  early transfer of unexpired direct-PUT capabilities.
- Implementation base: 810fba9d0890492712781e6362dc00489a555bb4.
- Isolated checkout; no production migration command has been run.
- Added member migration fields, mixed-mode route hints and transaction-level
  admission. Legacy callbacks retain their authenticated member identity.
  Cleanup selection filters migrated owners before the bounded batch limit.
- Added an authenticated exact-object inspection operation. Lazy runner
  construction avoids schema initialization during inspection; raw reads report
  active execution and upload obligations without starting recovery clocks.
  Unsupported dormant schemas are reported without mutation. Inspection is
  observational, not authorization to freeze or activate.
- Real Postgres proof covers partial import admission, same-member callback
  serialization, independent-member progress, missing-owner races and cleanup
  starvation. Existing owner and fleet-import Postgres tests also pass.
- Worker routing tests and Web, Worker and shared-contract typechecks pass.
  SQLite/RPC tests cover read-only inspection, exact-object authentication,
  contradictory resource identities, existing export and freeze behavior.
- Added an exact-member/attempt/generation graceful-checkpoint request to the
  container's existing shutdown path. Native port access does not start a
  stopped container; a missing or lost response remains unconfirmed. Acceptance
  is not checkpoint durability or native-stop evidence. The process now keeps
  its active-job count until its completion callback has settled, preventing a
  concurrent control response from exiting the process early.
- Added token-bound durable local quiescence. New starts return retry-later;
  current-attempt callbacks remain admitted. Closure waits for admitted launch
  RPCs before the operator can select a checkpoint target and survives object
  eviction. A failed storage write never acknowledges closure or reopens the
  in-memory gate. Final freeze still blocks all RPCs, settles tracked work and
  repeats the exact-target stop. Canonical member transitions and operator
  wiring for these primitives remain pending.
- Checkpoint/container and local barrier/inspection suites pass together: 319
  tests across four files. Worker and shared-contract typechecks and the
  complexity guard pass. These are local primitive proofs, not a completed
  handoff rehearsal or measured member-pause result.
- Implemented the managed-upload path for Postgres members. Containers negotiate
  support, stream one encrypted part directly to R2, and include the exact upload
  ID and ETag in the existing snapshot-completion request. The existing upload
  ledger records immutable byte identity before a part URL is returned, survives
  session replacement/deletion, and excludes direct-PUT capabilities for that
  same snapshot. Recovery can abort snapshot upload IDs through the existing
  resource purge endpoint. Old clients retain the direct path.
- Trusted completion seals the exact upload and streams the actual object through
  SHA-256 before acknowledging verification or canonical publication. It does
  not trust client metadata, ETags or multipart checksum formats. Lost completion
  replies require acknowledged abort/NoSuchUpload before readback; unknown aborts
  retain the durable obligation. This adds one storage read per new checkpoint;
  real R2 interoperability and latency still require composed rehearsal.
- Managed upload validation: 574 Worker tests and 31 real Postgres owner/resource
  tests pass. Web, Worker and shared-contract typechecks pass; complexity guard
  passes. The additive upload ledger migration is applied only to the isolated
  synthetic test database. Production remains unchanged.
- Extended controlled uploads to legacy members. Independent durable receipts
  survive current-session replacement. Managed/direct admission and cleanup
  share the existing consent mutex; exact abort precedes cleanup, member deletion
  and final freeze. Unknown aborts retain state. Read-only inspection counts
  pending receipts with bounded pages; frozen coverage rejects pending uploads.
  Schema 21 prevents older writers from ignoring these obligations; inspection
  accepts schema 20 without upgrading it. Compatible release convergence remains
  required before enabling managed legacy uploads.
- Legacy upload proof: 367 Worker tests across five focused files pass, including
  competing upload modes, duplicate allocations, current-session loss, ambiguous
  abort during deletion, terminal receipt retention, read-only paginated receipt
  inspection and legacy/Postgres owner routing. Worker and shared typechecks and
  the complexity guard pass. No production state was changed.
- Old direct capabilities must still drain while members remain live, before
  quiescence. Managed upload negotiation does not revoke previously issued URLs.
- Added canonical rolling campaign and token-bound member transitions. Each
  member reserves one exact inventory object, serializes against its callbacks,
  imports exact frozen pages, and activates independently. Member pages take a
  shared campaign lock; campaign closure permits migrated active executions.
  Import alone never activates routing. Wrong source, token and page identity
  fail closed. Empty-object handling and new-object closure remain pending.
- Activation commits an ordinary encrypted maintenance mailbox wake in the same
  transaction as backend ownership. Existing Temporal mailbox recovery owns
  missed signals; provider-capable crypto preparation stays outside the short
  database transaction. Deleted members transfer without creating a wake.
- Real Postgres proof passes: four new member migration tests plus the existing
  fleet migration test. It covers same-member callback serialization with an
  independently progressing member, complete import before activation, one wake
  across retries, deleted members and fleet closure during migrated execution.
  Web, Worker and shared typechecks and the complexity guard pass.
- Wired the authenticated exact-object member continuation: reserve canonical
  identity after conditionally closing local starts and deletion, request the exact active checkpoint,
  wait for completion, freeze, import one page per request and activate. Raw
  operator freeze/activation/import commands are rejected; only the source Worker
  supplies pages and transitions. Replaying activation also retries its existing
  wake signal after commit; durable mailbox recovery covers lost signal replies.
- Conditional readiness runs after admitted launches settle. Busy old containers
  must answer a non-mutating native GET capability probe before closure persists;
  old direct URLs and pending replica writes leave the member live. Rejected
  preflight can reopen only an unpersisted local barrier. Persisted closure never
  reopens. Final stop independently refuses an active attempt even after a
  checkpoint request was accepted. Native probes never auto-start containers.
- Controlled-byte verification now has a 60-second read deadline and cancels a
  stalled stream without granting verification or upload-settlement authority.
- Source proof: 349 tests across seven affected Worker files pass (including
  three operator transition-boundary cases); five real Postgres migration tests
  pass. Readiness/checkpoint/container, conditional closure and a resumable
  source-to-import continuation are covered. This remains local component and
  composed-source proof, not real R2 interop or a measured live member pause.
- Next implementation: empty-object migration, explicit new personal/group member
  ownership and legacy creation closure, then the authenticated hosted fleet
  operator. Busy pre-protocol processes remain live during readiness; release
  convergence and eventual completion of every held member must be proved in
  rehearsal and deployment. Do not mistake a skipped member for completion.
- Resolved the deletion race with failing-before/passing-after source tests.
  Read-only canonical observation precedes local closure; admitted deletion
  settles before readiness, and durable closure precedes canonical reservation.
  Deletion after closure retains the existing durable cleanup retry. Lost
  reservation replies preserve the barrier for exact-token recovery.
- Added exact-object empty migration. The barrier waits for admitted work and
  rechecks emptiness before persistence; a racing bind keeps its legacy runtime.
  Truly empty objects export four verified empty pages without constructing a
  runner or initializing SQL. Empty imports create no member execution owner.
- Verification for these changes: 25 Worker tests and five real Postgres tests
  pass; Worker, Web and shared typechecks and the complexity guard pass. Earlier
  deletion-focused proof also passes (40 Worker and four Postgres cases). These
  are local correctness checks; no production mutation or latency claim.
- Centralized member creation now assigns an explicit Postgres route in the
  creation transaction during rolling/Postgres mode. Personal identities, auth,
  referral/family signup and group containers all use this creation owner.
  Creation takes a nonblocking shared campaign lock: callers may already hold
  identity/family locks, so an exclusive transition yields retryable setup rather
  than an inverted lock wait. Deleted routes survive; conflicting owners cannot
  be overwritten; failed creation rolls back both records.
- Creation proof: eleven real Postgres cases cover route selection, transaction
  rollback, deletion, conflicting prior identity and campaign concurrency,
  including immediate retry during an exclusive transition. The affected signup
  suites were exercised; mock fixtures now include campaign reads while their
  canonical member lock-order assertions remain intact. Web typecheck passes.
- Creation/inventory closure still requires durable materialization intent before
  legacy object access, including ensure-processing, bound user routes, deletion,
  outbound callbacks and provider authorization. New-member routing alone does
  not cover older members' first use. The existing immutable inventory cannot be
  sealed while an unregistered legacy object can still materialize.
- Remaining before a final candidate: complete effect and
  control routing; creation/inventory closure; hosted
  operator; composed rehearsal; owner documentation and final review/CI. Keep
  the PR draft and the production campaign inactive until those are complete.
- Added durable legacy materialization intent before Worker source lookup and
  a source-side activation check before ordinary RPCs initialize storage. The
  provider census and admission intents share one ordered inventory. Creation
  closure preserves known legacy execution, rejects stale release admission,
  and routes an older member's previously unmaterialized first use to Postgres.
  Final inventory sealing rejects omissions and remains closed to new sources.
- Source admission races now return ordinary processing retry or HTTP 503 for
  user controls without calling a second backend. Worker typecheck and 21
  focused source-admission/processing/control tests pass.
- Added bounded settlement for default legacy owners left by lost first-use
  requests or completed empty imports. It requires a closed sealed census and
  all source dispositions, rejects prior generation/attempt/target authority,
  and commits one ordinary encrypted wake with activation. Existing mailbox
  recovery handles lost signals; deleted identities receive no wake. Concurrent
  settlement/retry proof and ordinary member import proof pass against isolated
  PostgreSQL: twelve tests across three files, including refusal to activate an
  empty receipt while creation remains open. Web and shared typechecks pass.
- Broader affected Worker verification passes: 507 tests across six files,
  including the HTTP route suite. The legacy operator's two regression tests
  pass; that operator still requires replacement for rolling migration. The
  campaign parser now separates campaign commands from object commands; shared
  typecheck, complexity guard and documentation drift checks pass.
- The hosted operator still needs durable one-at-a-time selection, resumable
  advancement and final accounting. Late empty objects from old Worker requests
  require composed serving-version/creation-closure proof before deployment;
  no production mutation or handoff timing claim has been made.
- Replaced the fleet-draining operator with a bounded rolling driver. It
  discovers provider objects, closes materialization, rescans and joins durable
  intents, verifies/resumes the inventory seal, advances exact source handoffs,
  settles unmaterialized owners and independently verifies final accounting.
- Ordered selection derives from existing source/activation receipts rather
  than a new lease. A completed import remains selected until its member is
  Postgres. Same-source retries use a deterministic token and cannot advance to
  a later member after a lost import/activation response. Pending readiness
  leaves the campaign live but delays later handoffs. Unknown late provider
  objects hold final closure instead of being silently omitted.
- Added the hosted CLI with read-only inventory default, bounded migration
  steps and aggregate output. It requires private Murph Cloud main execution;
  the private production environment has the required API and signing secret
  names (metadata inspected only). Signed control admission reuses existing
  method/path/body signatures and nonce replay protection alongside OIDC.
- Local proof: seven rolling-driver tests cover serial activation, intent-only
  sources, held readiness, restart after lost seal/import replies, bounded work
  and final inventory drift. Four CLI tests cover execution boundary, options,
  fresh signatures and aggregate-only output. Eleven Worker route/backpressure
  tests pass, including signed payload tampering and replay rejection. Four real
  Postgres handoff tests now prove ordered selection through activation. Worker,
  Web and shared typechecks pass; the complexity guard passes.
- Next: wire the protected private workflow, prove creation closure against
  late old-release requests and compose full handoff/R2/latency rehearsal. Final
  ReviewGPT, exact-head CI, merge, deployment and complete live migration remain
  required. The PR stays draft; no production mutation has been performed.

- Final operator route regression: 175 Worker tests across four files pass;
  Worker typecheck and documentation drift pass. The private workflow and
  late-old-request closure proof remain the next concrete work.

- Committed and pushed the rolling operator at d0af2d04d362. A fresh design
  consultation is reviewing exact-source creation closure, including late old
  requests and unknown sources; this is separate from final PR approval.
- Corrected hosted operator scheduling: a canary budgets one source rather than
  one page, and checkpoint/freeze waits poll that same source within a bounded
  run. Fourteen CLI/operator tests, Worker typecheck and complexity guard pass.
  The real tsx entrypoint loads and rejects local invocation before credentials.
- The private workflow is drafted in an isolated Murph Cloud checkout. It
  validates protected-main public ancestry, pins the source before dependency
  installation, serializes with Worker deployment, uses existing hosted-only
  credentials and defaults to aggregate inventory. Private verification/review
  and the public closure/rehearsal gates remain required before dispatch.
