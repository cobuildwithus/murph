# Consolidate vault storage ownership

Status: completed
Created: 2026-07-10
Updated: 2026-07-12

## Goal

- Reduce steady-state vault and portable-archive tiny-file count by making each
  datum or generated result have one clear owner: input-event mappings follow
  their input events, the inbox-capture ledger owns committed envelope metadata,
  parser attempts publish one consumed-as-a-unit bundle, and portable snapshots
  omit rebuildable or structure-only entries.

## Success criteria

- Trusted runtime-residue pruning removes mailbox mappings whose input events are
  pruned or already absent, without scanning or deleting outside the existing
  owner boundary.
- New inbox captures retain attachment bytes under `raw/inbox/**` but do not
  retain a redundant `envelope.json` after the equivalent canonical
  inbox-capture ledger record commits.
- A dry-run-first historical migration proves ledger/envelope equivalence before
  deleting legacy envelopes, and readers plus validators remain correct after
  migration without treating the missing redundant file as corruption.
- Each parser attempt publishes one versioned result bundle containing the
  manifest, chunks, normalized Markdown, and plain text consumed together;
  legacy attempts have an explicit safe migration or rebuild posture.
- The repo-owned portable ZIP keeps excluding rebuildable runtime projections
  and emits no explicit directory entries; shared hosted snapshot directory
  semantics remain unchanged.
- Focused regressions and a direct file-count scenario prove each steady-state
  reduction, full repo acceptance passes, all required completion audits have no
  unresolved accepted findings, and the PR ReviewGPT loop reaches zero accepted
  findings with final-head CI green.

## Scope

- In scope:
  - mailbox mapping lifecycle and existing runtime-residue pruning
  - inbox envelope write/read/validation plus explicit historical cleanup
  - parser attempt derived-artifact publication and consumption
  - portable snapshot entry classification and ZIP entry emission
  - focused tests and matching durable storage/layout documentation
- Out of scope:
  - experiment-image ownership already covered by PR #524
  - integration-ingest shard compression/replay work covered by PRs #475/#521
  - existing operation-record/runtime retention covered by PRs #236/#254
  - mutating any live vault or running an operator migration in production

## Constraints

- Technical constraints:
  - default to deletion and existing owner primitives; add no new service,
    database, queue, manager, or generic storage abstraction
  - preserve attachment bytes and canonical inbox-capture evidence; destructive
    historical cleanup must be proof-driven, dry-run-first, and auditable
  - keep derived parser output explicitly rebuildable and versioned
  - packaging-only changes must not mutate live vault state
- Product/process constraints:
  - work in the isolated task worktree and preserve unrelated changes
  - run the high-risk storage completion workflow, scoped commit helper, draft
    PR, ReviewGPT loop, and final PR CI/mergeability checks
  - keep local identifiers, sensitive inbox data, and raw payloads out of
    commits, logs, fixtures, review artifacts, and PR text

## Risks and mitigations

1. Risk: deleting an envelope or mapping that still has a live consumer.
   Mitigation: trace every reader, prove canonical equivalence/absence, fail
   closed on mismatch, and keep focused legacy-plus-current regression coverage.
2. Risk: parser bundling changes partial-write or retry semantics.
   Mitigation: publish one atomic versioned bundle and prove retries, reads, and
   rebuild behavior through the real owner API.
3. Risk: a packaging fix changes the bundle's established contents or hosted
   restore semantics.
   Mitigation: change only the repo-owned ZIP emitter's directory-entry flag and
   assert its existing projection exclusions; leave the distinct hosted tar
   collector unchanged.

## Tasks

1. Trace all four current write/read/validation/repair paths and freeze the
   smallest owner-boundary design.
2. Implement mailbox mapping pruning and inbox envelope ownership migration with
   focused data-loss and file-count regressions.
3. Implement atomic parser result bundles and legacy/rebuild handling with
   focused parser-worker/reader regressions.
4. Preserve the portable ZIP's existing runtime exclusions and omit explicit
   directory entries with archive-manifest regressions.
5. Update durable contracts, run direct scenarios and full acceptance, then run
   required security/privacy and coverage-write audits to resolution.
6. Close the plan through `scripts/finish-task`, push/open the draft PR, and run
   ReviewGPT plus PR CI/mergeability to completion.

## Decisions

- Treat the four findings as one file-count/ownership PR because they share the
  same frozen hosted workspace file-count invariant and verification target.
- Historical cleanup ships as an explicit owner migration; this task does not
  manually delete live-vault files.
- The analyzed rebuildable projection did not come from any current repo-owned
  ZIP path: the only vault ZIP emitter already excludes all `.runtime/**`, and
  hosted tar snapshots already exclude `.runtime/projections/**`. Therefore the
  packaging change only removes ZIP directory entries; classifier reuse would
  be a speculative content-contract change without the missing producer.

## Verification

- Commands to run:
  - focused owner tests selected after the evidence trace
  - direct temporary-vault file-count and migration scenarios
  - `pnpm verify:acceptance`
  - required `security-privacy-review` and `coverage-write` local audit passes
  - PR-head preflight plus `pnpm review:gpt pr-review` rounds
- Expected outcomes:
  - all focused and repo-wide checks pass
  - direct scenarios prove safe deletion/equivalence and reduced entry counts
  - no unresolved accepted audit or ReviewGPT findings remain
  - final PR head is pushed, mergeable, and green in CI

## Progress

- Implementation and direct owner-level regressions are complete for mailbox
  mapping cleanup, envelope ownership migration, parser result compaction, and
  portable ZIP entry reduction.
- The required security/privacy audit completed with no findings. The sole
  coverage-write audit completed with two accepted regression additions and no
  unresolved accepted findings.
- Focused assistant contract fixtures now use `sourceDirectory` and
  `resultPath`; the affected assistant packages typecheck, and their directly
  affected suites pass. A runtime loader timeout reproduced only during local
  resource contention and passed both singly and as its complete file under the
  normal timeout on immediate confirmation.
- Fresh focused proof passes for envelope migration (6 tests), parser attempt
  compaction (6 tests), runtime-residue pruning (15 tests), and the exact
  portable-ZIP entry scenario (1 test).
- Sequential owner typechecks pass for parsers, inboxd, inbox-services, CLI,
  assistant-engine, and assistant-runtime; the directly affected CLI service
  boundary test also passes (5 tests).
- The serialized full acceptance gate passed in 1,039 seconds, including all
  package tests, typechecks, guards, docs checks, artifact checks, smoke
  scenarios, the web build, and Cloudflare node plus worker suites.
- Remaining gates are scoped plan completion and commit, draft PR publication,
  the controller-held ReviewGPT pass, and final PR CI/mergeability.
- Safe blocker: do not commit, push, open a PR, or launch ReviewGPT until the
  controller grants the matching publication and review gates; the verified
  isolated worktree remains the handoff source of truth meanwhile.
Completed: 2026-07-12
