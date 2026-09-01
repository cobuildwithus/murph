# Prevent slash-named Vercel preview deployments

Status: active
Created: 2026-08-31
Updated: 2026-08-31

## Goal

- Prevent Vercel's Git integration from creating automatic Preview deployments
  for non-production branches, including the repository's slash-named task
  branches, while preserving automatic production deploys from `main`.

## Success criteria

- `apps/web/vercel.json` uses a branch pattern that covers names containing `/`.
- Focused regression proof evaluates representative slash-named branches as
  disabled and `main` as enabled under Vercel's documented matching rules.
- The scoped Vercel configuration test and repository complexity check pass.
- The exact pushed PR head passes required CI and the routed final ReviewGPT gate.

## Scope

- In scope: Vercel Git automatic-deployment admission and its focused config test.
- Out of scope: canceling existing deployments, changing production build logic,
  changing the ignored-build classifier, or changing manual/custom-environment
  deployment commands.

## Constraints

- Technical constraints: preserve `main` production admission and the current
  ignored-build behavior; use Vercel's existing `git.deploymentEnabled` owner.
- Product/process constraints: internal-only behavior, no Product UX or public
  changelog entry; use the deploy-surface PR and final-review workflow.

## Risks and mitigations

1. Risk: the broader glob could disable production deploys.
   Mitigation: keep the explicit `main: true` rule and exercise the documented
   any-true-wins behavior in focused proof.
2. Risk: a structural assertion could repeat the original false confidence.
   Mitigation: evaluate representative slash and non-slash branch names with
   Node's glob matcher rather than checking JSON shape alone.

## Tasks

1. Replace the single-segment wildcard with a globstar fallback.
2. Extend the existing production-deployment configuration test with semantic
   branch cases.
3. Run focused tests, config validation, complexity proof, and inspect the diff.
4. Commit, open the PR, run exact-head ReviewGPT concurrently with CI, and
   resolve any accepted findings.

## Decisions

- Reuse `git.deploymentEnabled`; no new script, dependency, or state owner.
- Use `**` rather than enumerating task-branch prefixes because the requirement
  is every non-`main` automatic Git deployment.

## Verification

- Commands to run:
  - `pnpm --dir apps/web test:prepared -- test/production-migration-guard.test.ts`
  - `pnpm --dir apps/web typecheck`
  - `pnpm complexity:diff`
  - `git diff --check`
- Expected outcomes: the focused suite proves `main` enabled and representative
  non-production branches disabled; complexity and whitespace checks pass.
