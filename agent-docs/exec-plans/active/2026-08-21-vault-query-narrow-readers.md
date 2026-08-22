# Stop exact and family-scoped CLI reads from rebuilding the full vault projection

Status: active
Created: 2026-08-21
Updated: 2026-08-22

## Goal

- Make narrow CLI reads scale with the requested record or family instead of
  walking every canonical source, refreshing the complete SQLite projection,
  and hydrating the whole vault.
- Preserve the full projection for commands whose product meaning is genuinely
  cross-family or aggregate.

## Success criteria

- Every remaining exact-record command identified by the source-backed
  ReviewGPT audit uses a canonical owner read or an existing bounded manifest
  read and does not call `query.readVault()`.
- Every remaining family-scoped command uses a family-owned canonical reader or
  a family/kind/date-filtered query API; supported aliases never fall back to a
  full-vault scan.
- Repeated aggregate commands in scope perform at most one command-scoped
  freshness check and query only the rows they need where the current query
  projection can support that without a new index or state owner.
- Direct and projected reads share existing lookup-family, event display
  identity, visibility, and lifecycle/revision helpers so their output cannot
  drift silently.
- Architecture tests prevent exact and family-scoped handlers from regaining a
  dependency on the full projection gateway.
- Behavioral tests prove representative exact reads succeed without creating
  or modifying `query.sqlite` and without opening unrelated canonical roots.
- Focused package tests and typecheck pass, exact-head CI is green, the
  preliminary specialist ReviewGPT coverage lens is resolved, and the final
  ReviewGPT gate reaches `ROUND_OUTCOME: PASS` with no accepted findings.

## Scope

- In scope:
  - Reconcile the original ReviewGPT audit with current `main`, retaining the
    narrow readers already landed by PR #2070 and later work.
  - Remaining generic show, audit show, manifest, intake, vault, journal,
    experiment, protocol, capture, blood-test, immunization, measurement-list,
    Murph Age input, and personal-pattern paths that still hydrate the complete
    vault for an exact, family-scoped, or duplicate aggregate read.
  - Small public query/core/vault-usecases seams and tests needed to express
    exact-record, family-scoped, and aggregate-projection capabilities.
  - Durable architecture documentation only where the final ownership contract
    is not already explicit.
- Out of scope:
  - Cross-family list/search/timeline, vault statistics, nutrition/wearable/
    metric analysis, experiment progress/outcomes, automatic experiment
    matching, export creation, and explicit projection rebuilds that genuinely
    require aggregate projection state.
  - A second index, incremental projection writer, source-generation journal,
    cross-process rebuild lock, or compatibility layer without measured need.
  - Cleanup unrelated to the audited projection-read call graph.

## Constraints

- Technical constraints:
  - `packages/core` remains the canonical record owner, `packages/query` remains
    the read/projection owner, and `packages/vault-usecases` remains a thin
    command-shaped composition layer.
  - Query state remains rebuildable and read-only relative to canonical writes.
  - Prefer extending existing public owner boundaries and shared registries over
    adding abstractions or persistent state.
  - Preserve current canonical IDs, aliases, visibility, lifecycle collapse,
    output shapes, and missing-record errors.
- Product/process constraints:
  - ReviewGPT authors the implementation patch from the original audit thread;
    the parent treats it as untrusted intent, inspects every hunk, and applies
    only the smallest current-main-safe design.
  - Use the isolated task worktree and preserve every unrelated checkout.
  - Keep this internal performance/architecture change free of new user-facing
    claims unless the final diff proves a meaningful member-visible outcome.

## Risks and mitigations

1. Risk: A direct reader returns a subtly different identity, visibility, or
   lifecycle result from the projection.
   Mitigation: Reuse shared lookup-family and event/lifecycle helpers and add
   direct-versus-projected parity fixtures for every migrated family.
2. Risk: Alias compatibility turns a bounded family lookup back into a vault
   scan.
   Mitigation: Resolve only documented aliases inside their owning family and
   fail with the existing typed not-found result otherwise.
3. Risk: Aggregate optimization creates a second freshness or persistence
   owner.
   Mitigation: Reuse the query projection's existing freshness owner in one
   command-scoped session; defer any new index or incremental writer.
4. Risk: The broad audit invites unrelated refactoring.
   Mitigation: Require each changed call path to correspond to a current
   `readVault()` offender and reject changes that do not reduce that bounded
   cost or protect the architecture mechanically.

## Tasks

1. Give the original ReviewGPT audit thread a current-main source bundle and
   this plan; have it return a patch that inventories and removes only the
   remaining exact, family-scoped, and duplicate aggregate full-vault reads.
2. Inspect every ReviewGPT hunk against current owners, split or delete
   speculative structure, and apply the accepted patch deliberately.
3. Add or refine focused regression tests for projection-file independence,
   unrelated-root isolation, direct/projected parity, bounded family aliases,
   aggregate freshness reuse, and static call-graph enforcement.
4. Run focused query, vault-usecases, CLI, scenario-integrity, and TypeScript
   proof; review the complete diff for privacy, architecture, and scope.
5. Commit and push the candidate, open a draft PR with complete evidence, and
   start the preliminary specialist coverage pass plus final ReviewGPT round 1
   concurrently with exact-head CI. Resolve accepted findings until PASS.
6. Run the parent final review, close this plan through `scripts/finish-task`,
   push the final head, and prove current-base mergeability.

## Decisions

- 2026-08-21: No open PR, active plan, active worktree, or live process owns the
  broader fix. One detached dirty checkout is inactive pre-merge residue from
  PR #2070 and remains untouched.
- 2026-08-21: Use the original ReviewGPT conversation so implementation retains
  the audit's rationale, while attaching a fresh current-main source bundle so
  already-landed narrow readers are not reimplemented.
- 2026-08-21: Classify the task as a standard, multi-package internal
  architecture/performance change with the coverage preliminary lens and the
  final cross-cutting ReviewGPT gate. Product UX and frontend are not
  applicable. Prompt review applies because this plan and package ownership
  guidance are part of the change.
- 2026-08-22: ReviewGPT returned the narrow-reader implementation from the
  original audit thread. Its first artifact expired before download; the same
  thread regenerated the scoped patch from the already-attached current-main
  snapshot, and the recovered artifact passed a full hunk review, privacy scan,
  forward apply check, and post-apply reverse check.
- 2026-08-22: Accept the exact/family-reader phase and its shared identity,
  visibility, lifecycle, bounded-source, filtered-collection, and architecture
  guard changes. Keep the three genuinely aggregate follow-ups separate:
  measurement-entry composition, Murph Age batch inputs, and wearable personal
  patterns need a command-scoped projection freshness design rather than an
  exact-reader substitution.
- 2026-08-22: Reject the attempted filtered projection substitution for the
  measurement record list. A production-faithful Junction regression proved
  that the filtered SQL date predicate does not preserve the existing
  canonical-day selection contract. The command remains on the full read model
  until the aggregate freshness phase can preserve that behavior explicitly.
- 2026-08-22: Accept all preliminary specialist findings and both final-round
  findings. Correct the prompt-lens disposition, restore canonical-day
  precedence in the shared filtered projection predicate, register canonical
  `vault_` IDs with the core lookup family, and collapse generic-show routing
  onto the shared lookup registries plus the existing query-family catalog.
  Projection/read-model parity, every generic-show route, typed misses, an
  initialized-vault exact read, and a delayed Europe/Berlin meal closeout now
  protect the corrected behavior.

## Verification

- Completed local proof:
  - Query suite: 66 files and 696 tests passed.
  - Corrected-head contracts suite: 40 files and 326 tests passed.
  - Original vault-usecases focused proof: 8 files and 50 tests passed.
  - Corrected-head vault-usecases suite: 44 files and 369 tests passed. The
    corrected routing and exact core-reader focused run passed 2 files and 5
    tests.
  - Corrected-head CLI suite: 126 files passed with 1,187 tests passed and 1
    skipped. The delayed-closeout focused proof passed 1 file and 11 tests.
  - Corrected-head `pnpm typecheck` passed, including query, vault-usecases,
    and CLI.
  - `pnpm test:scenario-integrity` passed for 207 scenarios, 12 sample inputs,
    and 29 golden-output directories.
  - `git diff --check`, artifact reverse-check, and privacy scans passed.
- Remaining exact-head proof:
  - Corrected-head GitHub Actions, final ReviewGPT `ROUND_OUTCOME: PASS`, and
    current-base `git merge-tree --write-tree` proof.
- Expected outcomes:
  - Representative exact and family reads do not create or modify the query
    projection and are insensitive to unrelated malformed records.
  - Output/error compatibility fixtures pass.
  - No exact/family handler reaches the full projection gateway.
  - No unresolved accepted ReviewGPT or CI finding remains.
