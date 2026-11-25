# Medical records app rollout

Status: active
Created: 2026-11-24
Updated: 2026-11-24

## Goal

Move hospital connections into the iOS app while preserving existing authorizations and imported records.

## Delivery and success criteria

1. **Current PR · app foundation (D1 adapters, D2, D5, D6).** Expand the session schema and deploy the shared callback reader before enabling native starts. Verify bearer-only search, start, proof-bound completion, neutral replay, receipt-based source list and removal. Browser callers retain their exact response shapes.
2. **Lifecycle (D3, D7, D8).** Close known-dead runs where failure is authoritative. Allow member-locked supersession, fence late outcomes, preserve first-start timestamps and isolate daily admission failures. Cover missing receipts and bounded grace without inventing a stall timer. Retain retrieval job identity.
3. **Retire browser UI (D1 deletions, D4).** Release native screens and universal-link readers before switching assistant links. Drain browser OAuth and legacy intent writers before removing adapters. Defer destructive schema cleanup.

## Decisions and risks

Prior verification and architecture review accepted native sessions independent of browser claims, existing bearer capability revalidation after exchange, a bounded bridge, and neutral replay. The persist transaction owns capacity on creation and reactivation. Receipt counts describe the latest import and unavailable counts remain absent. Once native rows exist the dual reader and scoped browser invalidation are the rollback floor. Keep both provider client configurations.

## Verification

Run owner-level callback, control plane, source projection, removal and browser regression tests plus Web typecheck. Exercise each stored status pair, invalid proofs on approval and denial, transport mismatch, bridge limits and concurrent authorization fences. Parent session owns final review and merge.

## PR 1 handoff

The five bearer routes, mixed-version schema, read-only callback dispatch and shared exchange are implemented. Receipt projection and member-locked capacity checks ship with the reader. Focused Web checks passed (409 tests), including all status pairs and proof checks. The opt-in clinical PostgreSQL suites passed all 32 tests on a fresh migrated database. The retention concurrency suite passed all nine tests. Web typecheck passed. The changelog covers the source slot freed by disconnect. The app release, final review, lifecycle work and web retirement remain pending.
