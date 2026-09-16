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
2. [pending] Implement all member routing, graceful/conditional handoff,
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
- Remaining before a final candidate: member state transitions and conditional
  admission closure; controlled final checkpoint/upload; complete effect and
  control routing; durable activation wake; creation/inventory closure; hosted
  operator; composed rehearsal; owner documentation and final review/CI. Keep
  the PR draft and the production campaign inactive until those are complete.
