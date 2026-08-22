# Foreground reply cardinality

Status: completed
Created: 2026-08-17
Updated: 2026-08-17

## Goal

- Make the foreground reply cardinality gate measure every supported filesystem
  read path and make the real hosted-input, session-routing, and durable outbox
  boundaries saturate before the shared high-cardinality plateau.

## Success criteria

- Callback and synchronous directory-handle scans are measured and rejected by
  the shared harness when their work grows with unrelated state.
- Session routing, outbox deduplication, and foreground outbox history use
  rebuildable exact-key projections while durable session and outbox records
  remain canonical.
- Hosted foreground input selection uses one fixed-size completion hint while
  the growing pending-input index remains canonical.
- Focused tests, diff-aware verification, exact-head CI, the preliminary
  specialist review, and final ReviewGPT rounds pass on the pushed candidate.
- PR #1887 remains one commit, has an accurate body, and is marked ready only
  after the exact head is green and cleanly mergeable with current main.

## Scope

- In scope: the shared filesystem meter and canaries, session-routing and outbox
  persistence owners, their state descriptors and recovery tests, the dedicated
  workflow/testing-map contract, and the PR review/verification loop.
- Out of scope: production telemetry, timing thresholds, a scenario registry,
  canonical-data changes, or a new runtime service, queue, or database owner.

## Constraints

- Keep one shared measurement contract with no per-probe budgets or exceptions.
- Keep projections rebuildable from canonical records, preserve terminal and
  quarantine transitions, and fail closed on ambiguous or corrupt state.
- Preserve the branch's single-commit shape and use an exact force-with-lease
  when replacing the published rebased head.

## Risks and mitigations

1. Risk: projection migration changes an existing routing or dedupe winner.
   Mitigation: convert valid legacy state directly where it is authoritative,
   validate projected hits against canonical records, and cover recovery paths.
2. Risk: an outbox transition leaves a stale active dedupe key.
   Mitigation: update the projection in the existing owner boundary for create,
   terminalization, quarantine, and pruning, with canonical-record validation.
3. Risk: a green gate hides another filesystem primitive.
   Mitigation: keep all instrumentation in the shared meter and add one growing
   negative canary for each newly supported primitive.

## Tasks

1. Apply the supplied directory-handle correction and durable testing-map entry.
2. Integrate the reviewed session-routing projection on current main.
3. Add the smallest exact-key outbox projection and focused lifecycle coverage.
4. Route foreground outbox history through bounded projection tags and replace
   the hosted pending-index scan with one fixed-size completion hint.
5. Run focused cardinality/persistence tests and diff-aware verification.
6. Close this plan, amend the single commit, push with an exact lease, and
   refresh the PR body.
7. Run the specialist and final ReviewGPT/CI loop until the exact head passes,
   then prove mergeability and mark the PR ready.

## Decisions

- Changelog is not applicable: this is an internal persistence and verification
  correction with no intentional member-facing behavior change.
- A projected hit is always checked against its canonical record. Positively
  corrupt projection state is quarantined; a write that may have reached SQLite
  is never replayed automatically, and the next ordinary attempt rebuilds.
- Legacy media-sensitive outbox identity recovery reads at most 100 projected
  candidates and fails closed above that fixed bound.
- Auto-reply delivery history and private-completion continuity reuse the same
  outbox projection through hashed exact route/provider tags. Candidate reads
  retain the existing 100-record foreground bound and canonical validation.
- The pending-input hint is published positive before canonical state and
  cleared only after canonical state, so an interrupted write can create only
  a safe false positive. Missing hints reconcile once under the runtime lock.
- Coverage and sensitive final-review lenses apply; frontend, prompt, and
  product-experience lenses do not apply unless the implementation broadens.

## Verification

- Run the shared meter harness, all three production cardinality adapters,
  focused assistant persistence/outbox and runtime-state tests, `pnpm test:diff`,
  `git diff --check`, exact-head required CI, preliminary
  `completion-specialists`, final `pr-review`, and `git merge-tree --write-tree`.
- Expected result: every high-cardinality sample is exactly equal from 128 to
  256, all persistence recovery/lifecycle tests pass, ReviewGPT has no accepted
  finding, and the final pushed head is green and mergeable.
- Local focused result: the 16-case meter harness, hosted-input boundary,
  session-routing boundary, full-turn queue-only handoff, reply-history tests,
  outbox lifecycle/recovery tests, and hosted-bundle tests pass.
Completed: 2026-08-17
