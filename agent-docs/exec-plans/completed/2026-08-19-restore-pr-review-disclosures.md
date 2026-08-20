# Restore PR review disclosures

Status: completed
Created: 2026-08-19
Updated: 2026-08-19

## Goal

- Restore the reviewer-facing PR disclosures removed by PR #1834 for
  non-obvious surfaces, architecture and reuse, foreground reply latency,
  provider-input size, and frontend design proof.

## Success criteria

- Every PR template includes dedicated non-obvious-surface, architecture,
  foreground reply path, and provider-input sections.
- User-facing hosted Web UI changes require a design-catalog representation and
  a dedicated design-proof section with risk-matched evidence.
- CI mechanically validates the architecture summary and applicable frontend
  design proof.
- Durable workflow and CI documentation match the template and checks.

## Scope

- In scope: PR-body policy, template fields, frontend design-proof enforcement,
  architecture-summary enforcement, focused tests, and CI wiring.
- Out of scope: restoring the deleted standalone product-experience lens or
  changing ReviewGPT pass topology.

## Constraints

- Preserve the newer Product UX, deployment, changelog, and categorized LOC
  contracts already present in the template.
- Keep screenshots risk-based; design proof can be a reasoned walkthrough when
  an image adds no proof.
- Reuse the current shared GitHub-rendered Markdown parser rather than
  duplicating it in each validator.

## Risks and mitigations

1. Risk: A restored frontend gate could impose screenshot busywork.
   Mitigation: Require catalog coverage and meaningful evidence, not a fixed
   screenshot count.
2. Risk: Optional risk prose could hide high-cost runtime changes.
   Mitigation: Give foreground reply and provider-input impact dedicated
   sections with explicit not-applicable reasons.

## Tasks

1. [x] Restore the five requested sections in the PR template and durable docs.
2. [x] Restore architecture-summary and frontend design-proof validation with
   focused tests.
3. [x] Wire the validators into the existing pull-request evidence workflow.
4. [x] Run focused checks and diff verification; start the required exact-head
   PR review gates after the scoped commit and push.

## Decisions

- The historical product-experience prompt was a lens inside the preliminary
  specialist ReviewGPT pass, not a separate ReviewGPT conversation. Its current
  Product UX replacement remains out of scope.
- Keep the current `Pull Request Evidence` workflow owner and restore the
  stronger checks inside it instead of reviving a second workflow.

## Verification

- Passed `node --test scripts/check-frontend-design-proof.test.mjs
  scripts/check-pr-architecture-summary.test.mjs
  scripts/check-pr-changelog.test.mjs
  scripts/check-pr-deployment-concerns.test.mjs` (31 tests).
- Passed `pnpm test:frontend-design-proof` (6 tests).
- Passed `pnpm test:diff`, including syntax and architecture/privacy guards,
  repo-tools typechecking, dependency policy, and 652 repo-tools tests across
  38 files.
- Passed the post-edit focused Frog workflow guard (4 tests), `git diff
  --check`, stale-reference search, and task-file privacy scan.

Completed: 2026-08-19
Completed: 2026-08-19
