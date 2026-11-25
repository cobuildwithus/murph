# Medical records app rollout

Status: active
Created: 2026-11-24
Updated: 2026-11-24
Current checkout: `murph-medical-records-lifecycle` (branch `records/lifecycle-recovery`)

## Goal

Move hospital connections into the iOS app while preserving existing authorizations and imported records.

## Delivery and success criteria

1. **Merged PR 1 · app foundation (D1 adapters, D2, D5, D6).** Expand the session schema and deploy the shared callback reader before enabling native starts. Verify bearer-only search, start, proof-bound completion, neutral replay, receipt-based source list and removal. Browser callers retain their exact response shapes.
2. **Current PR 2 · lifecycle (D3, D7, D8).** Close known-dead runs where failure is authoritative. Allow member-locked supersession, fence late outcomes, preserve first-start timestamps and isolate daily admission failures. Cover missing receipts and bounded grace without inventing a stall timer. Retain retrieval job identity.
3. **Retire browser UI (D1 deletions, D4).** Release native screens and universal-link readers before switching assistant links. Drain browser OAuth and legacy intent writers before removing adapters. Defer destructive schema cleanup.

## Decisions and risks

Prior verification and architecture review accepted native sessions independent of browser claims, existing bearer capability revalidation after exchange, a bounded bridge, and neutral replay. The persist transaction owns capacity on creation and reactivation. Receipt counts describe the latest import and unavailable counts remain absent. After native starts, the callback and bridge must recognize tagged native states for late returns and keep the stored-return fallback and scoped browser invalidation. Keep both provider client configurations.

## Verification

Run owner-level callback, control plane, source projection, removal and browser regression tests plus Web typecheck. Exercise each stored status pair, invalid proofs on approval and denial, transport mismatch, bridge limits and concurrent authorization fences. Parent session owns final review and merge.

## PR 1 handoff

The five bearer routes, mixed-version schema, read-only callback dispatch and shared exchange are implemented. Receipt projection and member-locked capacity checks ship with the reader. Focused Web checks passed (409 tests), including all status pairs and proof checks. The opt-in clinical PostgreSQL suites passed all 32 tests on a fresh migrated database. The retention concurrency suite passed all nine tests. Web typecheck passed. The changelog covers the source slot freed by disconnect. PR 1 shipped in f63ce059e4. The iOS implementation merged in murph-ios #756.

The full Web suite surfaced the predeploy guard’s required registration for the paired OAuth constraint. Registering the exact mixed-writer statement keeps altered and additional constraints blocked. All 91 production migration guard tests and Web typecheck passed after this change.

Round 1 passed. Follow-up verification passed 490 focused Web tests, 42 gated PostgreSQL tests on a fresh migrated database, and Web typecheck. PostgreSQL observed two native persistence transactions contend for the last slot. One committed a source, retrieval run and wake. The other hit the limit, as did a later reactivation at capacity.


## PR 2 handoff

The member can start over before a further runtime read. Successful authorization commits
supersession, credentials, the next generation and its wake together. Runtime reads repair
known-dead work, and a permanent count or plan rejection closes its own open generation.
Keep 30 minutes for a missing authorization-loss receipt and one daily interval of quiet
before daily admission replaces an open run. One-time sources rely on the member action.
The current runtime and Cloudflare wire contract already support these responses.
Deploy Web first. Keep its lifecycle handling to retain recovery and the PR 1 callback
reader to preserve native returns. Browser retirement remains PR 3.

Focused proof passed 423 Web tests, 39 gated clinical PostgreSQL tests on a fresh
migrated database, 44 runtime tests and 15 Cloudflare port tests. PostgreSQL observed
the start-over persistence wait for daily admission. Both replaced generations rejected
late outcomes, preserving the new source and run. Web typecheck and complexity passed.
Chromium checked the records overview, access-ended copy and release note at 390 and
1280 pixels. The three-PR rollout stays active until browser retirement.
