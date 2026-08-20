# Parallel release verification

Status: active
Created: 2026-08-20
Updated: 2026-08-20

## Goal

- Reduce the package-release acceptance critical path without weakening the
  release gate, while structurally preventing package coverage drift.

## Success criteria

- The release workflow runs package coverage, Web verification, fixture
  coverage, and Cloudflare verification as isolated required branches.
- Every current workspace package with coverage ownership is assigned exactly
  once, including Health Commons and the hosted local harness, and drift fails
  closed before coverage begins.
- Web test sharding proves an exact, duplicate-free union and keeps the
  memory-measured production build isolated.
- Focused local checks pass, required exact-head CI is green, preliminary
  specialist ReviewGPT is resolved, and final ReviewGPT returns PASS.
- The PR records the internal-only changelog decision and deployment contract.

## Scope

- In scope: release workflow DAG, release verification planning, package and Web
  verification entrypoints, regression tests, and matching verification docs.
- Out of scope: changing package coverage thresholds, internally splitting a
  package's Vitest coverage run, production runtime behavior, or publishing a
  release as part of this PR.

## Constraints

- Technical constraints: preserve one package process per isolated runner;
  retain CLI/contracts filesystem isolation, Assistant Engine memory isolation,
  the Web build memory guard, exact SHA packing, and fail-closed aggregation.
- Product/process constraints: keep the imported patch proportional, treat it
  as untrusted intent, use the worktree/PR lane, run both required ReviewGPT
  stages concurrently with CI, and preserve the immutable first-reviewed head.

## Risks and mitigations

1. Risk: sharding exposes hidden order or shared-filesystem dependencies.
   Mitigation: isolated jobs, exact-union checks, focused process-ownership
   tests, and repeated exact-head CI without retries.
2. Risk: the split accidentally weakens or skips a release prerequisite.
   Mitigation: explicit required-owner mapping, aggregate result checks, guard
   tests, and final packing only after all prerequisite jobs succeed.
3. Risk: optimistic wall-clock estimates hide a new long package shard.
   Mitigation: keep timing claims as estimates and use the first real release
   run to measure the two newly admitted suites.

## Tasks

1. Inspect and apply the recovered ReviewGPT patch against current main.
2. Audit every hunk for current ownership, simplicity, and invariant coverage.
3. Run focused release-plan, workflow-guard, Web lane, and diff checks.
4. Commit and push the candidate; open the complete PR intent contract.
5. Start preliminary specialists and final ReviewGPT round 1 concurrently with
   exact-head CI; triage and resolve all findings.
6. Run parent final review, close this plan through the scoped final commit,
   require green final-head CI, and complete the PR handoff.

## Decisions

- Product UX does not apply because this is internal release/verification
  infrastructure with no member-facing behavior.
- Changelog is not applicable because members cannot observe the workflow
  implementation itself.
- Final ReviewGPT is required because the change alters concurrency,
  fail-closed release behavior, and multiple verification owners.

## Verification

- Commands to run: patch integrity/readback, release-plan self-checks, focused
  Vitest suites for the changed scripts and Web lane, shell/Node syntax checks,
  `pnpm test:diff` for the changed paths when it remains the smallest truthful
  umbrella, exact-head GitHub Actions, preliminary `completion-specialists`,
  and final `pr-review` rounds.
- Expected outcomes: all focused checks pass, CI is green on the exact final
  head, specialist findings are resolved, and final ReviewGPT reports
  `ROUND_OUTCOME: PASS` with zero accepted findings.
