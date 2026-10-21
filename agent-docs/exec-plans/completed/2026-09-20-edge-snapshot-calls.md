# Reduce snapshot coordination requests

Status: completed
Created: 2026-09-20
Updated: 2026-09-20

## Goal

Reduce repeated snapshot coordination callbacks while retaining durable encrypted
backups, exact upload recovery, stale-owner rejection, and cleanup safety.

## Success criteria

- Snapshot creation, completion, cancellation and exact replay emit no heartbeat
  or handoff-completion callback from current producers.
- Managed completion reads its session and exact upload receipt in one existing
  resource command and relies on transactional final publication authority.
- Upload receipts, current references, recovery retention and resource retirement
  remain authoritative under concurrent cleanup and revocation.
- Focused Worker and Postgres proof plus relevant typechecks pass; a scoped draft
  PR is handed to the original completion owner for final review and CI.

## Scope

- In scope: snapshot port, Worker completion, Web resource cleanup, focused tests
  and current owner documentation.
- Out of scope: replica upload batching, telemetry, provider behavior, production
  mutations, database schema removal, merge or deployment.

## Constraints and decisions

- Postgres owns admission, upload obligations, publication and cleanup. Reuse the
  existing `snapshot_managed_read` response for both session and receipt.
- Remove the obsolete two-second heartbeat and its derived six-second start cap;
  retain the existing overall commit deadline and cancellation behavior.
- Keep heartbeat/completion route and command acceptance plus persisted columns
  for old Worker/container producers. Remove compatibility after their drain.
- No new wire shape or operation is emitted: old and new Web/Worker/container
  combinations remain valid. Neither uploads nor canonical refs change format.
- Snapshot sessions expire after sixty minutes; orphan cleanup starts after
  sixty-five. Exact pending uploads and canonical refs protect storage, and the
  publication transaction rejects retired objects. Heartbeat state no longer
  participates in current runtime replacement or cleanup authority.
- Remove only the three duplicate normal-completion owner reads. Exceptional
  cleanup still uses its existing checks and exact session commands.

## Risks and mitigations

- Revocation during R2 completion: exact admitted uploads may settle, while the
  final checkpoint transaction rejects stale publication.
- Cleanup concurrent with publication: retain shared locks, current-ref checks,
  independent pending upload receipts and terminal resource tombstones.
- Lost completion reply: preserve one exact replay, stable session headers and
  recovery of an already-current expired session.
- Deployment skew: keep old callback consumers and test old direct upload paths;
  managed completion uses the already-deployed combined read operation.

## Tasks

1. Delete heartbeat production and handoff completion bookkeeping calls.
2. Consolidate completion reads and remove duplicate preflight ownership calls.
3. Prove call counts, interruption/replay and Postgres cleanup/publication races.
4. Update architecture and owner docs; review privacy, scope and complexity.
5. Commit and open draft PR; original thread owns readiness and final ReviewGPT.

## Verification

- Passed: focused Cloudflare Vitest suite for runner platform, runner outbound,
  managed snapshot upload and resource client: four files, 580 tests.
- Passed: Web Postgres runtime-owner suite against an isolated loopback database:
  48 tests, including pending/settled/published snapshots with and without legacy
  heartbeats. Existing stale-owner, retention and cleanup race proofs remain.
- Passed: Cloudflare and Web typechecks, scoped Web ESLint, `pnpm docs:drift`,
  `git diff --check`, and `pnpm complexity:diff`.
- Complexity: cleanup maximum falls from 18 to 13. Existing completion (58),
  outbound router (22), snapshot-ref equality (22), and direct upload (27)
  hotspots remain unchanged. Their validation/dispatch/retry cases retain
  independent current obligations; moving branches would not simplify ownership.
- Candidate review: checked the complete source/test/doc diff, exact receipt
  identity, stale publication rejection, expired replay, old producer acceptance,
  no background callbacks, configured start deadline and private-data exclusion.
- Internal-only changelog: coordination callbacks change without a new member
  feature or changed durable backup behavior.

## Handoff

Implementation and local proof are complete. The original completion owner owns
parent candidate review, exact-head CI, final ReviewGPT and readiness. The draft
PR remains unmerged; no deployment or production mutation is part of this plan.
Completed: 2026-09-20
