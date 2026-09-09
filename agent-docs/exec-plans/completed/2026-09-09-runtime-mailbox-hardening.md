# Harden mailbox continuation and hint contracts

Status: completed
Created: 2026-09-09
Updated: 2026-09-09

## Outcome and scope

Open a reviewed hardening PR after the completed runtime-mailbox recovery.
Reduce repeated continuation/hint reasoning and make producer-reader drift and
cold-restore scheduling regressions executable. Preserve foreground priority,
imported continuation authority, exact retained jobs, strict transport parsing,
checkpoint acknowledgement, and invocation filters. This task ends with a PR;
it does not authorize a new production rollout.

## Evidence and design

- Deferred admission, idle schedule retirement, and selected-owner compaction
  repeatedly scan the same mailbox and reconstruct discarded-item sets. Replace
  those repeated calculations with one pure coverage projection, preserving
  separate execution-covered hints and idle-covered schedules. A dirty hint
  blocks idle schedule retirement across it even when execution can cover it.
- Preparation admits deferred dirty hints through an existing owner, while
  wake selection leaves the same work asleep. The existing checkpoint-restore
  matrix gained a wake assertion: all six deferred cases fail on the base,
  while six nondeferred controls pass. Share the narrow runnable admission
  decision between both consumers instead of adding a scheduler or retry owner.
- Provider manifests own emitted hint fields, but the strict transport reader
  separately refines their allowed types and timestamps. Enumerate real
  manifests through production shaping, JSON persistence, and parsing. Keep
  strict timestamp validation and avoid adding manifest/config dependencies to
  the transport reader merely to remove an allowlist.
- The contract regressions also prove that inherited allowlist properties pass
  the reader's unknown-field guard. Require an own property before resolving
  its kind. Both reproduced failures pass after that correction; the combined
  transport suites pass 149 tests and the package typecheck passes.
- Deployment retry and pagination owners already have distinct, appropriate
  contracts and incident regressions. They remain outside this PR.

## Ownership and failure behavior

All new decisions are transient pure derivations from existing mailbox state,
validated continuation IDs, and the invocation's time and filters. No new
persisted fields, queues, timers, external calls, or dependency are planned.
Coverage does not grant authority to bypass a frontier or acknowledge dirty
work without execution. Recording owners, invalid projections, substantive
device work, epochs, strict cadence ordering, and foreground interruption retain
their existing behavior. Old and new runners read the same persisted shapes.

## Execution and proof

1. Parent owns wake-decision reproduction, reader correction, plan/docs, and PR gates.
2. A mailbox subagent owns the pure coverage projection, shared admission,
   mailbox integration, and focused regression tests after an explicit handoff.
3. A contract subagent owns manifest-enumerated producer/reader regressions.
4. Keep the separately owned concurrent-import and provider-source-authority
   PRs untouched; inspect mergeability against their eventual main changes.
5. Run focused coverage, cold-restore, notification, preemption, and transport
   tests; run affected typechecks, complexity, docs, and privacy checks.
6. Complete parent review, push a stable draft, then start exact-head ReviewGPT
   concurrently with CI as soon as the PR is Ready. Keep one completion owner.
7. Close the plan and deliver the PR with its exact verification status.

## Product UX patch

- Outcome: Eligible device updates can request processing after a cold restore,
  while exact retained jobs keep their existing retry schedule.
- Reaches: Deferred dirty work behind a validated continuation; preserve ordinary
  device work, independent maintenance, recording recovery, and filtered work.
- Proof: Exercise wake selection before preparation, then checkpoint, restore,
  and acknowledgement through the existing synthetic mailbox journey. Provider
  execution is mocked at its existing seam; this proves runtime admission and
  durable progress, not a new production rollout or end-to-end provider import.

## Candidate verification

- Product UX: Ready. The deferred matrix covers direct and model-free wake
  scopes after checkpoint restore, with no persisted state mutation. The real
  workspace entrypoint clears newly exposed dirty hints on the next cold pass,
  then returns to a future wake; another pass at the same time performs no more
  dirty fetches, and the retained resource runs once at its original deadline.
- Current focused mailbox coverage: 311 cases across five suites. The five-suite
  run passed 309 before two final default/approved-priority cases were added;
  the complete changed mailbox-state file then passed all 34 cases.
- Producer-reader and existing transport suites: 149 passed. Changelog archive
  rendering: 10 passed. Assistant-runtime, device-syncd, and Web typechecks pass.
- Complexity guard passes: mailbox-state debt remains 5 and mailbox execution
  debt remains 20. Existing hotspots retain their boundaries; the refactor
  removes repeated scans without introducing durable ownership.
- Docs drift, doc gardening, whitespace, and private-identifier scan pass.
  Parent reviewed the complete source, tests, docs, and release-note diff; the
  independent read-only source review found no concrete ordering regression.
- Deployment retry/drain audit found existing primitives and regression tests
  sufficient; no deployment code or production state changed.
- Final pushed-head ReviewGPT and required CI remain PR delivery gates; their
  authoritative results belong to the PR checks and review evidence.

Implementation and parent candidate review are complete. PR #3102 owns final
ReviewGPT and exact-head CI evidence and remains open for review; no merge or
production deployment is part of this task.
Completed: 2026-09-09
