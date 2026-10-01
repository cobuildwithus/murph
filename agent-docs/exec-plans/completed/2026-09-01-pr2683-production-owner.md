# PR 2683 production deployment owner

Status: completed
Created: 2026-09-01
Updated: 2026-09-01

## Goal

- Make the Git-backed current-`main` Vercel deployment the sole ordinary production owner so admission evidence cannot be reused for a different deployment artifact.

## Success criteria

- Every `main` commit creates a Vercel production candidate.
- Local production deploys and historical promote, rollback, and force-promote paths are outside the supported production workflow.
- Migration and native canary guards require the deployed commit to equal current `main`.
- Focused tests, affected typecheck, documentation guards, and workflow syntax pass before the exact-head candidate is sent to CI and final ReviewGPT.

## Scope

- In scope: public hosted Web deployment configuration, release guards, focused tests, and durable deployment documentation.
- Out of scope: private Temporal deployment implementation and production provider configuration.

## Constraints

- Technical constraints: use existing Git integration and Vercel Deployment Checks; add no controller, queue, receipt service, or dependency.
- Product/process constraints: keep the PR draft until its exact pushed head passes ReviewGPT and required CI; preserve the private-before-public rollout order.

## Risks and mitigations

1. Risk: an alternate deployment path publishes an artifact whose commit differs from admitted `main`.
   Mitigation: remove repo-owned alternate paths, require exact equality at release boundaries, and document least-privilege Vercel roles.
2. Risk: recovery reuses stale compatibility evidence.
   Mitigation: recover through a fresh revert or forward-fix commit on `main`, which creates a new candidate and admission run.

## Tasks

1. Delete production build skipping and the local prebuilt production deploy owner.
2. Require exact current-`main` identity in migration and native canary guards.
3. Align tests and durable deployment/security/reliability documentation.
4. Run focused proof, affected typecheck, docs and complexity guards, then package the exact-head CI and ReviewGPT candidate.

## Decisions

- Use one Git-backed Vercel production owner and deletion-based enforcement instead of adding another stateful release coordinator.
- Treat rollback as a fresh revert or forward-fix commit, not historical deployment promotion.

## Verification

- Commands: focused Node tests; focused Vitest migration guard; hosted Web typecheck; `pnpm complexity:diff`; `pnpm docs:drift`; `pnpm docs:gardening`; workflow YAML parse; `git diff --check`.
- Outcomes: all affected checks passed. The workspace typecheck stopped only in unchanged Cloudflare readiness code whose option name no longer matches its dependency types; the hosted Web typecheck passed independently.
Completed: 2026-09-01
