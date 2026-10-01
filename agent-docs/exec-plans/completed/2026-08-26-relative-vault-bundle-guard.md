# Relative vault-cli bundle regression guard

Status: completed
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Replace the frequently ratcheted absolute `vault-cli` total-byte cap with an
  exact-base relative regression guard while retaining the stable startup,
  import-topology, and bundled/unbundled parity protections.
- Keep the implementation deletion-first, direct, and free of a new durable
  baseline, cache, service, or policy owner.

## Success criteria

- The canonical Linux bundle lane compares the exact merge candidate with its
  exact first-parent baseline and fails when total output grows by more than the
  greater of 96 KiB or 1 percent of baseline bytes.
- Baseline measurement cannot be changed or bypassed by editing a candidate-owned
  total-budget constant, and dependency or build-input changes are measured
  truthfully rather than combining base source with candidate-only artifacts.
- Existing absolute entry-chunk and static-startup-closure gates, external and
  single-copy dependency guards, and bundled/unbundled probes remain intact.
- Every comparison reports baseline, candidate, delta, allowance, and excess;
  failures also report the largest candidate outputs, without retaining the
  chronological per-feature budget comment.
- Focused tests and production-shaped direct proof cover the threshold boundary,
  malformed or unavailable baseline evidence, and unchanged production bundle
  assembly.
- A draft PR is opened, exact-head required CI is green, the preliminary
  specialist pass is resolved, and the final ReviewGPT loop reaches a resolved
  terminal result with no accepted finding left open.

## Scope

- In scope:
  - `vault-cli` esbuild metric and guard ownership.
  - The canonical Ubuntu x86_64 runner-bundle CI comparison lane.
  - Focused unit/workflow tests and the matching verification/deploy docs.
- Out of scope:
  - Changing runner runtime behavior, command availability, or bundle externals.
  - Changing the entry or static-startup absolute limits without new evidence.
  - Adding a long-term metrics service, GitHub artifact ledger, cache, approval
    label, or manual override path.

## Constraints

- Technical constraints:
  - Compare against the exact candidate first parent on the same Linux toolchain;
    never use macOS totals as deployment authority.
  - Preserve production assembly and deploy artifact fingerprints.
  - Fail closed when the claimed base/candidate relationship cannot be proven.
- Product/process constraints:
  - ReviewGPT authors the initial attachment-based implementation patch; the
    parent independently inspects, applies, verifies, and owns the final diff.
  - Prefer deletion and existing primitives over new state or abstractions.
  - Preserve unrelated worktrees and repository changes.

## Risks and mitigations

1. Risk: A relative per-PR gate permits cumulative long-term growth.
   Mitigation: Treat total bytes as a cliff-regression signal; retain the hard
   startup-closure boundary and report every total delta. Add an absolute total
   limit only if a measured deploy or cold-start SLO later proves one.
2. Risk: Measuring base and candidate with different dependencies or platforms
   creates a false comparison.
   Mitigation: Bind both measurements to the exact first-parent/candidate pair
   and canonical Linux x86_64 build contract, failing closed on provenance gaps.
3. Risk: The comparison doubles an already expensive bundle build.
   Mitigation: Reuse existing build/assembly primitives and accept extra work
   before adding cache or artifact ownership; optimize only from measured CI cost.

## Tasks

1. Inspect the current bundle guard, canonical CI lane, exact-base proof, and
   focused tests on fetched `origin/main`.
2. Ask ReviewGPT Pro for a complete scoped patch with tests and durable docs.
3. Inspect the full artifact, apply only the accepted patch, and make the
   smallest necessary parent-owned corrections.
4. Run focused unit, workflow, typecheck, and production-shaped bundle proof;
   review the complete diff for privacy and identifier leakage.
5. Commit and push a draft PR, complete the PR evidence contract, and mark the
   exact stable candidate Ready after local proof and parent review.
6. Run preliminary specialists and final ReviewGPT round one concurrently with
   required CI; resolve every accepted finding under the repository boundary.
7. Close this plan with `scripts/finish-task`, prove current-base mergeability,
   and hand off the reviewed PR and active worktree.

## Decisions

- Use the greater of 96 KiB or 1 percent, not 5 percent: at the current roughly
  9.5 MB bundle, five percent would permit about 477 KB in one PR while recent
  intended changes stayed below the proposed roughly 96 KB allowance.
- Keep absolute hot-path protections because the motivating June regression was
  a static import moving the lazy command graph into startup.
- Do not preserve the candidate-editable total cap or its chronological comment.

## Verification

- Commands to run:
  - Focused Vitest files selected from the returned patch paths.
  - Typecheck for every changed TypeScript owner.
  - Workflow/YAML contract proof for the changed Actions lane.
  - The canonical production runner bundle assembly and an exact-base/candidate
    comparison scenario on Linux CI.
  - Exact-head required GitHub Actions, preliminary `completion-specialists`,
    final ReviewGPT, and `git merge-tree --write-tree` against current `main`.
- Expected outcomes:
  - No per-feature total-budget edit is needed for ordinary bounded growth.
  - A candidate at the allowance passes and a one-byte-over candidate fails.
  - Static-import creep still fails independently of total-size movement.

## Completion evidence

- ReviewGPT's first implementation artifact was rejected because it added a
  large cache/worktree architecture. Its second exact-head artifact supplied
  the accepted sibling-checkout comparison without new durable state or raw Git
  isolation; the parent inspected and applied that patch.
- Focused verification passed: 32 Node workflow/boundary tests, 14 Cloudflare
  bundle tests, Cloudflare typecheck, workflow YAML parsing, the live workflow
  contract checker, `docs:drift`, `docs:gardening`, and `git diff --check`.
- The preliminary specialist pass found the missing filesystem/process-boundary
  proof and redundant detailed index guidance. The accepted test-only artifact
  and parent-owned docs correction resolved both findings; the expanded focused
  suite passed 32/32.
- Final ReviewGPT round one returned `ROUND_OUTCOME: PASS` with no qualifying
  findings on the unchanged production implementation. The later remediation
  was isolated to tests and explanatory process docs.
- Local full production assembly remained blocked before the changed bundling
  step by the unchanged 60-second Assistant Engine CLI-manifest timeout. The
  exact-head Ubuntu required check remains the authoritative clean full
  base/candidate assembly proof.
Completed: 2026-08-26
