# Simplify runtime ownership and retire proved compatibility paths

Status: active
Created: 2026-11-10
Updated: 2026-11-10

## Goal

Keep one exact physical-target resolver and remove runtime compatibility machinery only when its current consumers and durable recovery obligations are proven retired.

## Success criteria

- Retained small, standby and next-bank targets resolve to their original namespace for processing, completion, consent withdrawal and deletion.
- Every audit proposal has an explicit implementation or evidence-based hold disposition.
- Focused regression tests, relevant typechecks and complexity review pass; root owns final ReviewGPT and CI.

## Scope

Cloudflare runtime routing, native receipt compatibility, snapshots and Browser Vault; Web runtime ownership cutover schema, completion and media readers; their owner documentation.
No production mutation, deployment, rollback or physical namespace deletion.

## Protected invariants

Postgres remains admission authority. Native receipts and exact physical stoppedness remain execution evidence. Unknown completion never proves stoppedness. Upload and cleanup obligations survive account deletion. Shards retain authenticated identity and durable cleanup ownership. Historical migration SQL is immutable; destructive cleanup uses the postdeploy contract-migration lane.

## Tasks

1. Revalidate audit against the assigned base and install frozen dependencies.
2. Add regressions for retained-target routing and collapse duplicate resolution.
3. Inspect retired Web cutover readers and prepare postdeploy schema cleanup with focused PostgreSQL proof.
4. Establish current reader, producer, pending-work and rollback floors for each compatibility deletion.
5. Implement proven deletions; retain any path whose drain remains unproved and record the exact missing evidence.
6. Run focused checks, typechecks and complexity review; review diff and publish a draft PR for root review.

## Decisions and dispositions

1. **Retained-target resolver: implemented.** Five regressions reproduced the
   missing small namespace across wake, voice control, consent withdrawal,
   deletion and the routed completion callback. The duplicate adapter is deleted;
   the shared router takes the complete environment directly. Fresh allocation,
   exact target identity and unknown-stop behavior are unchanged.
2. **Retired Postgres cutover: client simplification implemented; physical cleanup
   retained.** Remove the two Prisma inventory models, inert owner/cleanup fields
   and test campaign setup. Deployment-pinned Vercel workflows may resume with old
   generated clients beyond the ordinary function drain; their runnable inventory
   and rollback floor are unproved. The executable DROP migration was removed.
   Actual-history proof keeps the terminal singleton, triggers and physical fields
   and verifies current admission/deletion without the retired Prisma shape.
3. **Old completion route, recheck wire boolean and SQLite column: retained.**
   Current producers use the canonical completion command, but old controllers
   still select the column and older Web/protocol witnesses require the boolean.
   Release evidence retains an older small-container image intentionally. Require
   controller and Worker convergence plus an explicit compatible rollback floor
   before retiring these readers; preserve early-versus-settled native completion.
4. **Legacy media read: retained.** Current Workers use atomic `admit_read`;
   supported older Workers can still authorize then call `read`. Require their
   drain and rollback exclusion before deleting that reader.
5. **Stale runtime docs: corrected.** Baseline invariants no longer describe an
   active migration gate; architecture identifies Postgres ownership and native
   execution receipts instead of UserRunner. The schema owner documents the
   deferred physical cleanup and the workflow/rollback boundary.
6. **Browser Vault monolith: retained.** Native Meals, Numbers, demographics,
   Journal and Games still read the shared replica. Settings export still serves
   old format sessions. Web presentation retirement is a separate lane. Removing
   the monolith requires the documented dual-reader deployment and rollback floor
   for 30 days, old session drain and historical root-reader recovery proof.
7. **Provider-context backfill and old settlement RPC: retained.** Current code
   uses native provider authority, but an old Worker/controller deployment can
   still need the old RPC or register a receipt without provider context. Require
   its producer and rollback floor before removing recovery of exact admitted
   invocations. A stale native receipt never grants canonical ownership.
8. **Legacy snapshot stream verifier: retained.** Require both a drained legacy
   snapshot receipt population and a producer/rollback floor that always records
   MD5 before removing the verifier. No pending-work absence or source introduction
   date alone proves that old producers cannot return.

Root coordinates bounded production evidence and final completion. This task
adds no runtime compatibility registry, feature flag or second owner. Billing's
retired Stripe-meter schema cleanup belongs to the separate billing lane.

## Verification

- Frozen dependency installation completed in the isolated task checkout.
- Five retained-small-target cases failed against the old composition. Final
  focused Cloudflare verification passes 421 tests across seven files.
- Current Web owner/checkpoint/cleanup/progress/direct-wake suites pass 148 tests;
  five additional PostgreSQL suites pass 18 tests for callback query counts, game
  allowance, member access, ledger retention and deleted-member cleanup.
- The final actual-history PostgreSQL regression passes. It proves real current
  runtime admission against the retained schema, exact owner/upload preservation,
  and the live runtime-log/Temporal receipt deletion guards.
- Cloudflare and Web typechecks pass. Complexity diff passes with no source
  hotspot over 20; the deleted resolver had maximum complexity 11 and shared
  routing remains 16. No network or database round trip is added.
- Docs drift/gardening and diff privacy checks pass. Changelog generation and
  four archive rendering tests pass using the existing presentation.
- The session-owned PostgreSQL fixture database was removed after verification;
  actual-history tests create and remove their own isolated databases.
- The shared worktree guard rejected one commit during changing registered-path
  inventory. A later read-only batch capacity probe passed. Public-safe Frog
  entry `20261110232635-worktree-storage-guard` records the diagnostic gap; no
  unrelated checkout was mutated and no guard was bypassed.
- Root owns candidate review, ReviewGPT, CI and final plan completion. Draft PR
  [#4826](https://github.com/cobuildwithus/murph/pull/4826) is published; the plan
  stays active for that owner.
