# Align Docker and CI Node selection to one repo baseline

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Make the hosted runner image and GitHub Actions use the same Node version baseline that the repo already documents and configures locally.
- Remove avoidable Node-version drift between local host setup, CI, and the hosted container build.

## Success criteria

- The Cloudflare hosted runner Dockerfile builds from Node `24.14.1` instead of a looser major-only tag.
- GitHub Actions jobs that currently use `22` or `latest` read the same exact pinned version from one repo-owned source.
- Focused tests and docs reflect the tighter pin without changing the broader compatibility floor documented for operators.

## Scope

- In scope:
- `Dockerfile.cloudflare-hosted-runner`
- `.github/workflows/**` jobs that currently use loose Node selectors
- a shared repo-level Node pin file
- focused Cloudflare contract tests and Node-version documentation
- Out of scope:
- rewriting every package `engines.node` field to an exact version
- changing local setup scripts unless the tighter shared pin requires it
- unrelated hosted runtime or release-flow refactors

## Constraints

- Technical constraints:
- Keep the existing compatibility floor `>=24.14.1` where scripts depend on that range syntax.
- Use one checked-in exact version source for CI so workflows do not drift from the hosted container pin.
- Preserve the current Docker build contract and app-local runner bundle flow.
- Product/process constraints:
- Preserve unrelated dirty worktree edits.
- Finish with focused verification, the required final review pass, and a scoped commit.

## Risks and mitigations

1. Risk: Tightening package `engines` to an exact version could break local setup scripts that parse `>=...`.
   Mitigation: Keep `engines.node` as the compatibility floor and pin actual runtime selectors separately.
2. Risk: Workflow pin changes could miss one release or support lane.
   Mitigation: Update every current `actions/setup-node` occurrence that still uses `22` or `latest`.
3. Risk: Tests and docs could drift from the Dockerfile pin.
   Mitigation: Update the existing Cloudflare image contract test and the matching runtime docs in the same change.

## Tasks

1. Add a shared exact Node pin file for CI/runtime consumers.
2. Pin the hosted runner Dockerfile and GitHub workflows to that shared version.
3. Update focused tests/docs that assert or describe the hosted runner Node version.
4. Run repo typecheck and targeted Cloudflare verification.
5. Complete the required audit pass and prepare the scoped commit.

## Decisions

- Keep repo/package compatibility declarations at `>=24.14.1`, but pin actual CI and hosted-container execution to exact `24.14.1`.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/container-image-contract.test.ts test/deploy-automation.test.ts`
- Expected outcomes:
- Repo typecheck stays green.
- The focused Cloudflare contract coverage passes with the tighter Node pin.
Completed: 2026-04-09
