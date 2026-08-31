# Cyclomatic Complexity Diff Guard

Status: active
Created: 2026-08-31
Updated: 2026-08-31

## Goal

- Add a fast, diff-aware cyclomatic-complexity guard that every code PR runs
  locally during agent scope review and again in exact-head CI.
- Make complexity regressions actionable without forcing unrelated PRs to pay
  down all existing complexity debt.

## Success criteria

- The analyzer follows ESLint's classic branch-counting semantics for supported
  JavaScript and TypeScript syntax.
- Changed source files fail only when complexity debt above the configured
  threshold or the per-function maximum increases relative to the PR base.
- The report identifies current hotspots so the implementing agent must judge
  whether additional behavior-preserving decomposition is worthwhile.
- The command is required by the completion workflow, represented in the PR
  template/evidence guard, and rerun against base/head SHAs in required CI.
- Focused analyzer, PR-evidence, workflow-policy, typecheck, and diff checks pass.

## Scope

- In scope: authored JavaScript/TypeScript source, diff/base resolution,
  deterministic text and JSON reports, tests, agent workflow documentation, PR
  evidence, and the existing host-support CI lane.
- Out of scope: whole-repository cleanup, cognitive-complexity scoring,
  third-party source, generated output, tests/fixtures, or an external hosted
  quality service.

## Constraints

- Technical constraints: reuse the existing Babel parser dependency; keep the
  guard fast and read-only; handle added, deleted, renamed, and working-tree
  files; compare immutable base/head blobs in CI.
- Product/process constraints: preserve existing PR and ReviewGPT ownership;
  do not turn the metric into a proxy for correctness or require speculative
  abstractions merely to lower a number.

## Risks and mitigations

1. Risk: an absolute cap blocks unrelated changes in legacy hotspot files.
   Mitigation: ratchet only debt and maximum complexity relative to the base.
2. Risk: extracting helpers can raise raw summed complexity because every
   helper starts with one path.
   Mitigation: measure debt above the threshold and per-function maximum rather
   than raw file totals.
3. Risk: parser/counting drift makes reports untrustworthy.
   Mitigation: encode ESLint's documented classic semantics and lock them with
   focused syntax fixtures.
4. Risk: agents ignore an advisory report.
   Mitigation: require a structured PR-body disposition and rerun the same
   command in exact-head CI.

## Tasks

1. Implement and test source analysis, diff discovery, and the new-code ratchet.
2. Add the local package command and completion-workflow requirement.
3. Add structured PR evidence validation and exact-head CI execution.
4. Run focused proof, inspect the final diff, complete review gates, and open
   the PR.

## Decisions

- Use ESLint's classic complexity threshold of 20 as the initial debt boundary.
- Follow Sonar's new-code quality-gate model: legacy debt may remain, but a PR
  may not increase it.
- Reuse `@babel/parser`; do not add a dependency or external service.

## Verification

- Commands to run: focused Vitest for the analyzer and PR checker, repository
  tools typecheck, workflow-policy tests, `pnpm complexity:diff`, and
  `git diff --check`.
- Expected outcomes: syntax fixtures match the expected scores; improving and
  neutral diffs pass; debt or maximum regressions fail; PR evidence rejects
  missing judgments; this PR reports no complexity regression.
