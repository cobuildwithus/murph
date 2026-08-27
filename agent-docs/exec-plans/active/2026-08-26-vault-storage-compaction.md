# Compact rebuildable vault storage

Status: active
Created: 2026-08-26
Updated: 2026-08-27

## Goal

- Reduce hosted vault checkpoint size and work without weakening canonical
  replay, explicit audit access, or backdated event corrections.

## Success criteria

- Everyday query rebuilds omit audit rows and audit search documents while
  explicit audit listing, inspection, stats, and export remain complete.
- Query schema no longer creates indexes with no production reader.
- Closed event months are stored compressed, and a later backdated append
  safely rewrites the affected archive without losing existing rows.
- Focused tests, typecheck, direct compatibility/size proof, required ReviewGPT
  gates, and exact-head CI pass on the PR candidate.

## Scope

- In scope: query projection policy, explicit audit read routing, unused query
  indexes, event-ledger shard read/write/archive behavior, focused tests, and
  architecture/reliability documentation needed for the storage contract.
- Out of scope: canonical audit deletion, event delta encoding, metric-point
  normalization, wearable-summary redesign, integration-ingest format changes,
  and hosted deployment execution.

## Constraints

- Technical constraints: canonical JSONL history remains authoritative;
  compressed closed shards must be lossless and atomically replaced; readers
  tolerate current JSONL plus compressed closed shards; no second index or
  migration service is added.
- Product/process constraints: ReviewGPT authors the initial implementation;
  the parent independently reviews and verifies it; preserve private evidence
  boundaries and unrelated worktree state; use the PR lane and required
  specialist/final review workflow.

## Risks and mitigations

1. Risk: a backdated revision targets a compressed historical month.
   Mitigation: use one archive-aware append primitive that reads the closed
   shard, adds the record, and atomically replaces the archive. Select the
   physical representation under the existing canonical write lock rather than
   persisting a stage-time representation flag.
2. Risk: removing audits from general projection breaks explicit audit tools or
   vault statistics.
   Mitigation: route those exact consumers to canonical audit storage and add
   regression coverage for list/show/stats/export behavior.
3. Risk: old and new runtime versions observe different event-shard shapes.
   Mitigation: keep readers dual-format and document the supported rollout and
   rollback window before enabling the compressed writer.

## Tasks

1. [done] Send three evidence-backed pieces from the exact clean base to
   parallel ReviewGPT implementers.
2. [done] Inspect and reconcile the delivered audit/index patches, then
   reconstruct the completed ledger design after its attachment and source
   workspace were lost during ReviewGPT artifact capture.
3. [done] Run focused query and ledger tests, typecheck, direct archive
   amendment/replay proof, and before/after storage measurements.
4. [in progress] Push the review candidate, open the PR, add its source-linked
   changelog entry, and complete the required preliminary specialist, final
   ReviewGPT, and exact-head CI gates before closing the plan.

## Decisions

- Keep canonical audits; remove only their rebuildable everyday query/search
  copies.
- Reject `audit` at the generic projected list/search boundary; dedicated audit
  commands and canonical-source export remain the explicit owners.
- Prefer existing integration-ingest compression/atomic-replacement patterns
  over a new archival subsystem.
- Keep event append operations and hosted receipts representation-neutral. The
  logical event path and base receipt are authoritative; the existing canonical
  write owner derives plain versus gzip when it mutates.
- Do not normalize metric payloads or integration receipts: measured savings
  do not justify a new storage format.
- Keep event archive creation explicit and inactive in this compatibility
  phase. Deploy and drain all dual-format readers before activating the first
  gzip writer; that first archive establishes the reader-capable rollback
  floor.

## Verification

- Commands to run: focused package tests selected from the changed owners,
  package typechecks, `git diff --check`, a synthetic closed-month append/read
  scenario, and a representative query rebuild size comparison.
- Expected outcomes: no loss of canonical rows or explicit audit behavior;
  rebuild excludes audit search/index copies; compressed closed event shards
  remain readable and amendable; exact candidate head passes required CI.
- Completed local proof: full core, contracts, and query test suites; package
  typechecks and builds; workspace boundary, dependency cycle, and dependency
  policy guards; focused archived-reference retention and query-source tests;
  archived append resume/rollback/stale-base tests; hosted restore replay; and
  audit-preserving export-pack fallback.
- Review disposition: accepted the round-two retrospective and deleted the
  event-specific archive flag from staging, stored operations, hosted receipts,
  restore parsing, replay, resume, and rollback. Added deterministic proof for
  staging against plain JSONL, archiving before commit, and committing into the
  single gzip representation. Accepted the specialist coverage gaps. For the
  specialist UX finding, removed `audit` from the generic projected family
  enum instead of adding a canonical audit scan to generic search.
