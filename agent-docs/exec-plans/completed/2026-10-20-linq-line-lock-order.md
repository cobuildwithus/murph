# Preserve a consistent Linq line lock order

Status: completed
Created: 2026-10-20
Updated: 2026-10-20

## Goal

Keep legitimate group recovery and line observation transactions from aborting one another through opposite acquisition orders for the existing line row and phone advisory lock.

## Success criteria

- A deterministic local PostgreSQL reproduction exposes the original cycle; the corrected production owners let both operations complete with correct capacity and delivery authority.
- Focused tests, Web typecheck, complexity/privacy checks, final ReviewGPT, and exact-head required CI pass.
- Merge, actual production deployment, and downstream observation remain distinct evidence gates.

## Scope

- Existing Linq capacity, line upsert, and delivery transaction owners; focused synthetic proof and their lock contract.
- No retries, timeouts, provider calls, authorization changes, schemas, persisted state, dependencies, or production recovery operations.

## Product UX

- Outcome: preserve the existing private group recovery message when concurrent line observation occurs.
- Reaches: eligible recovery with available capacity; exhausted or unhealthy lines; duplicate delivery claims; existing routes.
- Proof: concurrent real PostgreSQL owners plus focused transport authority/idempotency tests; production delivery proof only after an authorized deployment.

## Constraints

- ReviewGPT authors substantive concurrency changes; parent proves the mechanism and critically inspects the patch.
- Preserve exact normalized-phone identity and legacy lookup-key rotation, quota accounting, idempotency, and route/member authority.
- Use synthetic loopback-only database fixtures and privacy-safe aggregates. Preserve unrelated active work.

## Risks and mitigations

1. Moving one lock can introduce another cycle or broaden writes before authorization.
   Inspect every capacity caller and the composed lock order; prefer reordering existing work at its owner.
2. A nearby production deadlock does not identify its historical competing transaction.
   Report the demonstrated reachable mechanism separately from uncertain incident attribution.
3. Canonical native release prerequisites and review access may block delivery.
   Preserve gates and exact candidate state; never treat a PR or quiet logs as recovery.

## Tasks

1. Reproduce the cycle using real capacity/upsert functions and exact existing lock identity.
2. Obtain a narrow ReviewGPT implementation and convert the diagnostic into regression coverage.
3. Verify authority, quota, duplicate, and concurrency cases; review cost, privacy, docs, and changelog applicability.
4. Commit, push, complete final review and required CI, and merge under standing authorization.
5. Deploy through the canonical workflow and observe affected outcomes using native follow-up controls when available.

## Decisions

- The recovery path can hold the line row before upsert acquires its phone advisory lock; ordinary upserts acquire the phone lock first.
- No same-root-cause PR or concrete file collision was found. Unrelated welcome classification in another checkout is outside this task.
- Existing telemetry establishes a deadlock family; additional telemetry is not needed to prove this local mechanism.

## Verification

- Original real PostgreSQL diagnostic: one transaction completes, one aborts with SQLSTATE 40P01. The involved source owners match the serving revision.
- Web typecheck passes with the synthetic diagnostic.
- ReviewGPT authored the narrow owner correction; parent inspected all four supplied files and composed capacity callers.
- Original production source with the new concurrent transport regression fails P2010/40P01. Corrected source passes seven synthetic PostgreSQL cases, 127 line-store/transport tests, and two existing final-slot/rollback cases.
- Removing only the locked reread makes the concurrent readable-key creation regression fail; restoring the exact verified source preserves one legacy identity.
- Web typecheck, documentation drift and complexity guard pass; maximum complexity changes 19 to 20 with no debt or hotspot. No provider input changes.
- Product UX Ready: eligible recovery succeeds after transaction commit; duplicate, exhausted, disabled, unhealthy, expired and invalid-token paths preserve their existing outcomes. Acceptance remains distinct from delivery.
- Focused lint passes for all three TypeScript files. Changelog generation and ten archive rendering tests pass for the content-only entry.
- Parent review is Ready; final ReviewGPT, exact-head required CI, merge, actual deployment and production observation remain pending separate release gates, tracked in PR4242 and automation memory.
- No production data, provider messages, recovery/replay, configuration or access changes were performed. Shared deployment preparation and callback compatibility remain separately owned.
Completed: 2026-10-20
