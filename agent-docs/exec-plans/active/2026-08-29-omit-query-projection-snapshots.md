# Omit query projection from hosted snapshots

Status: active
Created: 2026-08-29
Updated: 2026-08-29

## Goal

- Stop transporting the rebuildable query SQLite projection in new hosted workspace snapshots while preserving complete query results after cold restore through the existing freshness-and-rebuild path.

## Success criteria

- New hosted snapshot archive plans omit `.runtime/projections/query.sqlite`, `query.sqlite-wal`, and `query.sqlite-shm` before archive entry reads, hashing, compression, encryption, or upload.
- A cold restore without the query database causes the first query-dependent read to await one rebuild from canonical vault state and return the expected complete result.
- Existing restore parsing remains compatible with older snapshots that contain the query database triplet.
- Running query schema and read APIs remain unchanged.
- Focused snapshot and query tests, relevant typechecks, and repository review gates pass on the exact PR head.

## Scope

- In scope: delete the query-specific hosted snapshot portability exception; update affected snapshot tests; add cold-restore rebuild proof; align runtime-state documentation and durable architecture wording.
- Out of scope: query schema/version changes, query read-path changes, canonical JSON slimming, new queues/services/cursors, or changes to legacy archive parsing.

## Constraints

- Technical constraints: query data remains a machine-local rebuildable projection; exclusion must happen in archive-plan traversal; older archives remain readable; no partial or empty query result may escape while a rebuild is required.
- Product/process constraints: this is a Product UX Patch. It reaches hosted members whose container cold-restores before a query-dependent turn and idle hosted workspaces creating checkpoints. There is no new UI, copy, or interaction surface.

## Risks and mitigations

1. Risk: the first query after a cold restore could observe a missing or partial database.
   Mitigation: retain the existing shared rebuild promise and transactional projection replacement, and add direct cold-restore query-result proof.
2. Risk: removing the cache could make older snapshots unreadable.
   Mitigation: leave restore parsing/materialization unchanged and keep compatibility coverage for archives with arbitrary runtime entries.
3. Risk: snapshot code could still stat or read excluded SQLite files before filtering.
   Mitigation: remove the inclusion exception at the planner predicate so traversal stops at `.runtime/projections` before descending into the triplet; assert the resulting plan and archive omit it.

## Tasks

1. Prove the current snapshot-planning and query-rebuild ownership boundaries.
2. Remove the exact query projection portability exception and align durable docs.
3. Update snapshot expectations and add a cold-restore canonical rebuild regression.
4. Run focused tests, relevant typechecks, and inspect the final diff.
5. Commit and push the exact candidate, open the PR, and run required specialist/final review gates concurrently with CI.
6. Resolve accepted findings, complete exact-head checks, archive this plan, and hand off the completed PR.

## Decisions

- Classification: the query SQLite triplet is derived, rebuildable, machine-local cache state, not product truth or required runtime continuity.
- Ownership: `packages/runtime-state` owns hosted archive selection; `packages/query` already owns freshness detection, single-flight rebuild, and transactional materialization. No new owner or state machine is warranted.
- Source of truth: canonical vault files remain authoritative; new snapshots transport those files and reconstruct the projection on demand.
- Product outcome: members receive the same complete query answers; the only intended behavior change is less checkpoint work and a possible existing rebuild wait on the first cold query.
- Architecture shape: delete the portability exception and reuse generic projection exclusion plus existing query initialization. No compatibility shim is added because restore remains permissive.
- Changelog decision: not applicable unless review identifies a member-visible promise change; this changes internal derived-cache transport without changing the member-facing capability.

## Verification

- Commands to run: focused runtime-state hosted-bundle tests; focused Cloudflare workspace snapshot and runtime-bridge tests; focused query concurrency/rebuild tests if changed proof depends on them; relevant package typechecks; `git diff --check`; repository PR checks and required ReviewGPT gates.
- Expected outcomes: exact query triplet absent from new archive plans and tar entries; restored canonical data produces a fresh query projection and correct query result on first read; no schema or API surface changes; all scoped checks pass.
- Completed focused proof:
  - `pnpm --dir packages/runtime-state test -- hosted-bundle.test.ts` (the package wrapper ran all 29 runtime-state files): 214 tests passed.
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/workspace-snapshot-local.test.ts apps/cloudflare/test/runtime-bridge-workspace.test.ts`: 58 tests passed.
  - `pnpm exec vitest run --config packages/query/vitest.config.ts --no-coverage packages/query/test/query-projection-concurrency.test.ts`: 2 tests passed.
  - `pnpm --dir packages/runtime-state typecheck` and `pnpm --dir apps/cloudflare typecheck`: passed.
  - `git diff --check`: passed.
- Remaining: exact-head preliminary specialist review, final ReviewGPT round, required PR checks, parent final review, and plan closure.
