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
3. [pending] Implement hosted resumable operator, source discovery and creation
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
- Remaining before a final candidate: member state transitions and conditional
  admission closure; controlled final checkpoint/upload; complete effect and
  control routing; durable activation wake; creation/inventory closure; hosted
  operator; composed rehearsal; owner documentation and final review/CI. Keep
  the PR draft and the production campaign inactive until those are complete.
