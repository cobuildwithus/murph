# Disable Vercel pull request preview deployments

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Stop Vercel's Git integration from automatically creating preview deployments for pull-request and other non-production branches while preserving automatic production deployments from `main`.

## Success criteria

- `apps/web/vercel.json` disables Git deployments for every branch except `main` using Vercel's supported `git.deploymentEnabled` configuration.
- The checked-in configuration remains valid against Vercel's published schema.
- Direct config and diff validation pass; heavyweight completion reviews are skipped per explicit user instruction for this simple change.

## Scope

- In scope: automatic Git-triggered Vercel deployments for the hosted web project.
- Out of scope: production deployments from `main`, manual Vercel CLI/API deployments, deploy hooks, existing preview deployments, and Cloudflare or Render deployment behavior.

## Constraints

- Technical constraints: the Vercel project is GitHub-connected, uses `main` as its production branch, and has `apps/web` as its project root.
- Product/process constraints: keep the control checked in at the owning Vercel project root and avoid a custom ignore script or dashboard-only state.

## Risks and mitigations

1. Risk: a catch-all rule could also suppress production deployments.
   Mitigation: explicitly enable `main`; Vercel deploys when any matching rule is `true`, so `main` remains enabled even though it also matches `*`.
2. Risk: the change could be mistaken for disabling every preview mechanism.
   Mitigation: document that it disables automatic Git deployments only; manual preview deployments and existing deployments remain unchanged.

## Tasks

1. Confirm Vercel's current documented branch-deployment configuration and the linked project's production branch/root directory.
2. Add the minimal branch rules to `apps/web/vercel.json`.
3. Validate the JSON and published Vercel schema and inspect the final diff.
4. Finish the plan, commit, push, and open the PR without heavyweight review gates per user instruction.

## Decisions

- Use `git.deploymentEnabled` instead of `ignoreCommand`: the former prevents the automatic Git deployment itself rather than creating and then skipping a build.
- Use `{ "main": true, "*": false }` instead of `false` so automatic production deploys continue.

## Verification

- Passed: read-only Vercel API confirmation that the linked GitHub project uses `main` as its production branch and `apps/web` as its root directory.
- Passed: JSON parse plus validation of the exact branch map against Vercel's published schema at `https://openapi.vercel.sh/vercel.json`.
- Passed: `git diff --check`.
- Not required per explicit user instruction: completion audit subagents, ReviewGPT, and the full acceptance suite. A started acceptance run was intentionally interrupted after that instruction; its interrupted subprocess results are not treated as verification evidence.
Completed: 2026-07-14
