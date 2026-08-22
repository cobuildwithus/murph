# Restore PR LOC breakdown requirement

Status: completed
Created: 2026-08-19
Updated: 2026-08-19

## Goal

- Restore the required categorized added/deleted LOC breakdown in every Murph
  pull request while preserving the newer proportional Product UX and evidence
  contract.

## Success criteria

- `AGENTS.md` and the durable workflow docs require the breakdown.
- The pull-request template includes the five-category table and total.
- The completion workflow defines the classification and interpretation rules.
- Focused text/reference checks and diff validation pass.

## Scope

- In scope: PR-body routing, durable PR-description policy, and the default PR
  template.
- Out of scope: restoring every field removed by PR #1834 or adding a new CI
  parser for category assignment.

## Constraints

- Technical constraints: keep the table compact and generated churn separate
  from authored source.
- Product/process constraints: treat LOC as reviewer orientation and a
  scope-anomaly signal, never as a quality target.

## Risks and mitigations

1. Risk: Restoring the table could recreate the former wall-of-text PR body.
   Mitigation: Restore only the compact breakdown and retain the newer short
   outcome, Product UX, evidence, risk, deployment, and changelog sections.

## Tasks

1. Trace the regression to the exact merged commit and affected files.
2. Restore the requirement in routing and durable workflow documentation.
3. Restore the categorized table in the PR template.
4. Run focused reference, Markdown, privacy, and diff checks; inspect the final
   patch and commit it through the plan-aware task finisher.

## Decisions

- Keep PR #1834's proportional Product UX and evidence structure; restore only
  the missing change-shape contract requested in this task.
- Preserve the original five categories: source, tests/fixtures, docs,
  config/tooling, and generated/other.
- Root cause: PR #1834 replaced the former detailed PR contract with the short
  form, removed the change-shape table, and explicitly prohibited a manual
  line-count table.

## Verification

- Passed focused `rg` reference checks, Markdown readback, `git diff --check`,
  added-line privacy scanning, and final scoped-diff inspection.
- Passed `node --test scripts/check-pr-changelog.test.mjs
  scripts/check-pr-deployment-concerns.test.mjs` (21 tests).
- Passed `pnpm test:diff` for the six task paths; the lane completed shell and
  Node syntax, hosted architecture and privacy guards, repo-tools TypeScript,
  and dependency policy.
Completed: 2026-08-19
